import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLinearFixtureService,
  LINEAR_FIXTURE_SCOPE,
} from "../src/server/linear/fixture";
import type { LinearBulkMemberResult, LinearIssue } from "../src/shared/linear";

const ref = { ...LINEAR_FIXTURE_SCOPE, issueId: "fixture-linear-42" };

describe("Linear fixture operation results", () => {
  it("returns isolated comment changes and deletion acknowledgements through every action", async () => {
    const service = createLinearFixtureService();
    const created = (await service.call("linear_comment", {
      ...ref,
      requestId: randomUUID(),
      action: "create",
      body: "Original comment",
    })) as LinearIssue;
    const comment = created.changedComment!;
    expect(comment.body).toBe("Original comment");
    comment.body = "Modified response snapshot";
    const stored = (await service.call("linear_get_issue", ref)) as LinearIssue;
    expect(stored.comments.find((value) => value.id === comment.id)?.body).toBe(
      "Original comment",
    );

    const updated = (await service.call("linear_comment", {
      ...ref,
      requestId: randomUUID(),
      action: "update",
      commentId: comment.id,
      expectedUpdatedAt: comment.updatedAt,
      body: "Updated comment",
    })) as LinearIssue;
    expect(updated.changedComment).toMatchObject({
      id: comment.id,
      body: "Updated comment",
    });
    await expect(
      service.call("linear_comment", {
        ...ref,
        requestId: randomUUID(),
        action: "update",
        commentId: comment.id,
        expectedUpdatedAt: comment.updatedAt,
        body: "Stale replacement",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const reacted = (await service.call("linear_reaction", {
      ...ref,
      requestId: randomUUID(),
      action: "add",
      commentId: comment.id,
      emoji: "+1",
    })) as LinearIssue;
    expect(reacted.changedComment?.reactions).toHaveLength(1);
    const unreacted = (await service.call("linear_reaction", {
      ...ref,
      requestId: randomUUID(),
      action: "remove",
      commentId: comment.id,
      emoji: "+1",
      reactionId: reacted.changedComment!.reactions[0].id,
    })) as LinearIssue;
    expect(unreacted.changedComment?.reactions).toEqual([]);
    const deleted = (await service.call("linear_comment", {
      ...ref,
      requestId: randomUUID(),
      action: "delete",
      commentId: comment.id,
      expectedUpdatedAt: unreacted.changedComment!.updatedAt,
    })) as LinearIssue;
    expect(deleted.deletedCommentId).toBe(comment.id);
    expect(deleted).not.toHaveProperty("changedComment");
    expect(deleted.comments.some((value) => value.id === comment.id)).toBe(
      false,
    );
  });

  it("keeps failed bulk changes atomic and continues in deduplicated input order", async () => {
    const service = createLinearFixtureService();
    const before = (await service.call("linear_get_issue", ref)) as LinearIssue;
    const rejected = (await service.call("linear_bulk", {
      ...LINEAR_FIXTURE_SCOPE,
      requestId: randomUUID(),
      issueIds: [ref.issueId],
      patch: { priority: 1 },
      addLabels: ["missing-label"],
    })) as { results: LinearBulkMemberResult[] };
    expect(rejected.results[0]).toMatchObject({
      issueId: ref.issueId,
      success: false,
      saved: false,
      retryable: true,
    });
    const unchanged = (await service.call(
      "linear_get_issue",
      ref,
    )) as LinearIssue;
    expect(unchanged.priority).toBe(before.priority);
    expect(unchanged.labels).toEqual(before.labels);
    expect(unchanged.updatedAt).toBe(before.updatedAt);

    const result = (await service.call("linear_bulk", {
      ...LINEAR_FIXTURE_SCOPE,
      requestId: randomUUID(),
      issueIds: [
        "missing-issue",
        ref.issueId,
        ref.issueId,
        "fixture-linear-43",
      ],
      patch: { priority: 1 },
      addLabels: ["linear-label-bug", "linear-label-bug"],
    })) as { results: LinearBulkMemberResult[] };
    expect(result.results.map((value) => value.issueId)).toEqual([
      "missing-issue",
      ref.issueId,
      "fixture-linear-43",
    ]);
    expect(result.results.map((value) => value.success)).toEqual([
      false,
      true,
      true,
    ]);
    result.results.slice(1).forEach((value) => {
      expect(value).toMatchObject({ saved: true, retryable: false });
      expect(value.issue?.priority).toBe(1);
      expect(
        value.issue?.labels.filter((label) => label.id === "linear-label-bug"),
      ).toHaveLength(1);
    });
  });
});
