import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLinearFixtureService,
  LINEAR_FIXTURE_SCOPE,
} from "../src/server/linear/fixture";
import { describeTemplate, estimateValues } from "../src/server/linear/service";
import {
  type LinearIssue,
  type LinearMetadata,
  type LinearPage,
} from "../src/shared/linear";

const ref = { ...LINEAR_FIXTURE_SCOPE, issueId: "fixture-linear-42" };
describe("Linear source contracts", () => {
  it("resolves a created fixture issue's own URL to its native issue ID", async () => {
    const service = createLinearFixtureService();
    const created = (await service.call("linear_create_issue", {
      ...LINEAR_FIXTURE_SCOPE,
      requestId: randomUUID(),
      title: "A newly created issue",
    })) as LinearIssue;
    expect(created.url).toBe(
      `https://linear.app/fixture/issue/${created.identifier}`,
    );
    await expect(
      service.call("linear_resolve_issue", {
        connectionId: LINEAR_FIXTURE_SCOPE.connectionId,
        url: created.url,
      }),
    ).resolves.toMatchObject({ issueId: created.issueId });
  });
  it("keeps body and comment search while returning only list fields", async () => {
    const service = createLinearFixtureService();
    const detail = (await service.call("linear_get_issue", ref)) as LinearIssue;
    await service.call("linear_comment", {
      ...ref,
      requestId: randomUUID(),
      action: "create",
      body: "comment-only-list-keyword",
    });
    const page = (await service.call("linear_list_issues", {
      ...LINEAR_FIXTURE_SCOPE,
      query: "comment-only-list-keyword",
      stateId: detail.state.id,
    })) as LinearPage;
    expect(page.issues.map((issue) => issue.issueId)).toEqual([ref.issueId]);
    expect(page.issues[0]).not.toHaveProperty("body");
    expect(page.issues[0]).not.toHaveProperty("comments");
    const loaded = (await service.call("linear_get_issue", ref)) as LinearIssue;
    expect(loaded.body).toBe(detail.body);
    expect(
      loaded.comments.some(
        (comment) => comment.body === "comment-only-list-keyword",
      ),
    ).toBe(true);
  });
  it("continues a lightweight list after its first 100 issues without duplicates", async () => {
    const service = createLinearFixtureService();
    for (let index = 0; index < 100; index++)
      await service.call("linear_create_issue", {
        ...LINEAR_FIXTURE_SCOPE,
        requestId: randomUUID(),
        title: `Page issue ${index}`,
      });
    const first = (await service.call(
      "linear_list_issues",
      LINEAR_FIXTURE_SCOPE,
    )) as LinearPage;
    expect(first.issues).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    const second = (await service.call("linear_list_issues", {
      ...LINEAR_FIXTURE_SCOPE,
      cursor: first.cursor,
    })) as LinearPage;
    expect(second.issues).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect(
      new Set([...first.issues, ...second.issues].map((issue) => issue.issueId))
        .size,
    ).toBe(102);
    await expect(
      service.call("linear_list_issues", {
        ...LINEAR_FIXTURE_SCOPE,
        cursor: "missing-cursor",
      }),
    ).rejects.toThrow("cursor");
  });
  it("pages comments and returns a newly acknowledged reply even beyond the first page", async () => {
    const service = createLinearFixtureService();
    for (let index = 0; index < 64; index++)
      await service.call("linear_comment", {
        ...ref,
        requestId: randomUUID(),
        action: "create",
        body: `Comment ${index}`,
      });
    const first = (await service.call("linear_get_issue", ref)) as LinearIssue;
    expect(first.comments).toHaveLength(30);
    expect(first.commentsHasMore).toBe(true);
    const second = (await service.call("linear_comments", {
      ...ref,
      cursor: first.commentsCursor,
    })) as {
      comments: LinearIssue["comments"];
      hasMore: boolean;
      cursor: string;
    };
    expect(second.comments).toHaveLength(30);
    expect(second.hasMore).toBe(true);
    expect(
      second.comments.some((comment) =>
        first.comments.some((prior) => prior.id === comment.id),
      ),
    ).toBe(false);
    const created = (await service.call("linear_comment", {
      ...ref,
      requestId: randomUUID(),
      action: "create",
      body: "Reply after sixty-five comments",
      parentId: first.comments[0].id,
    })) as LinearIssue;
    expect(created.comments).toHaveLength(30);
    expect(created.changedComment).toMatchObject({
      body: "Reply after sixty-five comments",
      parentId: first.comments[0].id,
    });
    expect(
      created.comments.some(
        (comment) => comment.id === created.changedComment?.id,
      ),
    ).toBe(false);
  });
  it("preserves native workflow, unrelated labels, threaded replies, and write deduplication", async () => {
    const service = createLinearFixtureService();
    const first = (await service.call("linear_get_issue", ref)) as LinearIssue;
    const labelled = (await service.call("linear_change_labels", {
      ...ref,
      requestId: randomUUID(),
      add: ["linear-label-bug"],
    })) as LinearIssue;
    expect(labelled.labels.map((label) => label.id)).toEqual([
      "linear-label-design",
      "linear-label-bug",
    ]);
    const request = {
      ...ref,
      requestId: randomUUID(),
      action: "create",
      body: "Thread reply",
      parentId: first.comments[0].id,
    };
    const [one, duplicate] = (await Promise.all([
      service.call("linear_comment", request),
      service.call("linear_comment", request),
    ])) as LinearIssue[];
    expect(one.comments).toHaveLength(2);
    expect(duplicate.comments).toEqual(one.comments);
    expect(one.comments[1].parentId).toBe(first.comments[0].id);
    const updated = (await service.call("linear_update_issue", {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: one.updatedAt,
      patch: { stateId: "linear-state-done" },
    })) as LinearIssue;
    expect(updated.state.type).toBe("completed");
    expect("open" in updated).toBe(false);
    expect(updated.project).toEqual(first.project);
  });
  it("detects stale content and keeps other scopes, labels, and duplicate requests safe", async () => {
    const service = createLinearFixtureService();
    const initial = (await service.call(
      "linear_get_issue",
      ref,
    )) as LinearIssue;
    await service.call("linear_update_issue", {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: initial.updatedAt,
      patch: { title: "Changed elsewhere" },
    });
    await expect(
      service.call("linear_update_issue", {
        ...ref,
        requestId: randomUUID(),
        expectedUpdatedAt: initial.updatedAt,
        patch: { body: "Stale replacement" },
      }),
    ).rejects.toThrow("changed elsewhere");
    await expect(
      service.call("linear_get_issue", { ...ref, workspaceId: "another" }),
    ).rejects.toThrow("match");
    const id = randomUUID();
    await service.call("linear_change_labels", {
      ...ref,
      requestId: id,
      add: ["linear-label-bug"],
    });
    await expect(
      service.call("linear_change_labels", {
        ...ref,
        requestId: id,
        remove: ["linear-label-bug"],
      }),
    ).rejects.toThrow();
  });
  it("reports bulk success/failure per Issue and validates project milestone identity", async () => {
    const service = createLinearFixtureService();
    const result = (await service.call("linear_bulk", {
      ...LINEAR_FIXTURE_SCOPE,
      requestId: randomUUID(),
      issueIds: [ref.issueId, "missing"],
      patch: { priority: 1 },
    })) as { results: { issueId: string; success: boolean }[] };
    expect(result.results.map((value) => value.success)).toEqual([true, false]);
    const current = (await service.call(
      "linear_get_issue",
      ref,
    )) as LinearIssue;
    await expect(
      service.call("linear_update_issue", {
        ...ref,
        requestId: randomUUID(),
        expectedUpdatedAt: current.updatedAt,
        patch: { projectId: null, projectMilestoneId: "linear-milestone" },
      }),
    ).rejects.toThrow("match");
    expect(
      ((await service.call("linear_get_issue", ref)) as LinearIssue).project,
    ).not.toBeNull();
  });
  it("keeps label definition deletion distinct and rejects another author comment edits", async () => {
    const service = createLinearFixtureService();
    await expect(
      service.call("linear_comment", {
        ...ref,
        requestId: randomUUID(),
        action: "update",
        commentId: "linear-comment-1",
        body: "Overwritten",
      }),
    ).rejects.toThrow("own");
    await expect(
      service.call("linear_label_definition", {
        ...LINEAR_FIXTURE_SCOPE,
        requestId: randomUUID(),
        action: "delete",
        labelId: "linear-label-design",
        scope: "workspace",
      }),
    ).rejects.toThrow("scope");
    const meta = (await service.call("linear_label_definition", {
      ...LINEAR_FIXTURE_SCOPE,
      requestId: randomUUID(),
      action: "delete",
      labelId: "linear-label-design",
      scope: "team",
    })) as LinearMetadata;
    expect(
      meta.labels.some((label) => label.id === "linear-label-design"),
    ).toBe(false);
    expect(
      ((await service.call("linear_get_issue", ref)) as LinearIssue).labels,
    ).toEqual([]);
  });
  it("uses actual team estimate scale and rejects complex templates without dropping data", () => {
    expect(
      estimateValues({
        issueEstimationType: "tShirt",
        issueEstimationAllowZero: true,
        issueEstimationExtended: true,
      }),
    ).toEqual([0, 1, 2, 3, 5, 8, 13, 21]);
    expect(
      estimateValues({
        issueEstimationType: "notUsed",
        issueEstimationAllowZero: true,
        issueEstimationExtended: true,
      }),
    ).toEqual([]);
    expect(
      describeTemplate({
        id: "simple",
        name: "Simple",
        description: "",
        type: "issue",
        templateData: { title: "Title", priority: 2 },
        content: "Description",
      }).supported,
    ).toBe(true);
    expect(
      describeTemplate({
        id: "complex",
        name: "Form",
        description: "",
        type: "issue",
        templateData: { children: [{ title: "Child" }] },
        content: "Body",
      }).supported,
    ).toBe(false);
  });
  it("keeps source template defaults unless the description is explicitly cleared", async () => {
    const service = createLinearFixtureService();
    const inherited = (await service.call("linear_create_issue", {
      ...LINEAR_FIXTURE_SCOPE,
      requestId: randomUUID(),
      title: "Chosen title",
      templateId: "linear-simple-template",
    })) as LinearIssue;
    expect(inherited.body).toContain("Template description");
    expect(inherited.priority).toBe(3);
    expect(inherited.labels.map((label) => label.id)).toEqual([
      "linear-label-design",
    ]);
    const cleared = (await service.call("linear_create_issue", {
      ...LINEAR_FIXTURE_SCOPE,
      requestId: randomUUID(),
      title: "Explicitly cleared",
      templateId: "linear-simple-template",
      body: "",
    })) as LinearIssue;
    expect(cleared.body).toBe("");
  });
  it("detects a changed comment before overwriting a retained edit draft", async () => {
    const service = createLinearFixtureService();
    const created = (await service.call("linear_comment", {
      ...ref,
      requestId: randomUUID(),
      action: "create",
      body: "Original comment",
    })) as LinearIssue;
    const comment = created.comments.find(
      (value) => value.body === "Original comment",
    )!;
    await service.call("linear_comment", {
      ...ref,
      requestId: randomUUID(),
      action: "update",
      commentId: comment.id,
      expectedUpdatedAt: comment.updatedAt,
      body: "Changed elsewhere",
    });
    await expect(
      service.call("linear_comment", {
        ...ref,
        requestId: randomUUID(),
        action: "update",
        commentId: comment.id,
        expectedUpdatedAt: comment.updatedAt,
        body: "Retained draft",
      }),
    ).rejects.toThrow("changed elsewhere");
    const current = (await service.call(
      "linear_get_issue",
      ref,
    )) as LinearIssue;
    expect(
      current.comments.find((value) => value.id === comment.id)?.body,
    ).toBe("Changed elsewhere");
  });
});
