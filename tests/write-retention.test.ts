import { describe, expect, it } from "vitest";
import { createFixtureService, FIXTURE_REPO } from "../src/server/fixture";
import {
  createLinearFixtureService,
  LINEAR_FIXTURE_SCOPE,
} from "../src/server/linear/fixture";
import type { LinearIssue } from "../src/shared/linear";

describe("native fixture request retention", () => {
  it("keeps a GitHub comment from being posted again after 256 later updates", async () => {
    const service = createFixtureService();
    const ref = { repo: FIXTURE_REPO, number: 42 };
    const input = {
      ...ref,
      requestId: "original-comment",
      body: "Post this fictional comment once",
    };
    const original = await service.comment(input);
    await expect(service.comment(input)).resolves.toEqual(original);
    for (let index = 0; index < 256; index++)
      await service.update({
        ...ref,
        requestId: `later-update-${index}`,
        patch: { title: `Later title ${index}` },
      });
    await expect(service.comment(input)).rejects.toMatchObject({
      code: "uncertain",
    });
    await expect(
      service.comment({ ...input, body: "A different comment" }),
    ).rejects.toMatchObject({ code: "conflict" });
    const current = await service.get(ref);
    expect(
      current.comments.filter((comment) => comment.body === input.body),
    ).toHaveLength(1);
    expect(current.title).toBe("Later title 255");
  });

  it("keeps a Linear comment from being posted again after 256 later updates", async () => {
    const service = createLinearFixtureService();
    const ref = { ...LINEAR_FIXTURE_SCOPE, issueId: "fixture-linear-42" };
    const input = {
      ...ref,
      requestId: "original-comment",
      action: "create",
      body: "Post this fictional comment once",
    };
    const original = await service.call("linear_comment", input);
    await expect(service.call("linear_comment", input)).resolves.toEqual(
      original,
    );
    let updated = original as LinearIssue;
    for (let index = 0; index < 256; index++)
      updated = (await service.call("linear_update_issue", {
        ...ref,
        requestId: `later-update-${index}`,
        expectedUpdatedAt: updated.updatedAt,
        patch: { title: `Later title ${index}` },
      })) as LinearIssue;
    await expect(service.call("linear_comment", input)).rejects.toMatchObject({
      code: "uncertain",
    });
    await expect(
      service.call("linear_comment", { ...input, body: "A different comment" }),
    ).rejects.toMatchObject({ code: "conflict" });
    const current = (await service.call(
      "linear_get_issue",
      ref,
    )) as LinearIssue;
    expect(
      current.comments.filter((comment) => comment.body === input.body),
    ).toHaveLength(1);
    expect(current.title).toBe("Later title 255");
  });
});
