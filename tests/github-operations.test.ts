import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createFixtureService, FIXTURE_REPO } from "../src/server/fixture";
import {
  callGitHubOperation,
  classifyMarkdownTemplate,
  createGitHubOperations,
} from "../src/server/github-operations";
import { GitHubError, type GhRunner } from "../src/server/github";
import { type GitHubService } from "../src/shared/contracts";
import { type FieldValue } from "../src/shared/github-operations";

const ref = { repo: FIXTURE_REPO, number: 42 };
const rawIssue = (number = 42) => ({
  id: number,
  node_id: `fixture-issue-${number}`,
  number,
  title: `Issue ${number}`,
  state: "open",
  html_url: `https://github.com/${FIXTURE_REPO}/issues/${number}`,
  repository_url: `https://api.github.com/repos/${FIXTURE_REPO}`,
  updated_at: "2026-10-22T00:00:00Z",
  milestone: null,
  type: null,
});
const fields = [
  { id: 12, name: "Summary", data_type: "text" },
  { id: 13, name: "Points", data_type: "number" },
  { id: 14, name: "Due date", data_type: "date" },
  {
    id: 15,
    name: "Priority",
    data_type: "single_select",
    options: [{ id: 1, name: "High" }],
  },
  {
    id: 16,
    name: "Areas",
    data_type: "multi_select",
    options: [
      { id: 2, name: "Frontend" },
      { id: 3, name: "Backend" },
    ],
  },
  { id: 17, name: "Unsupported", data_type: "people" },
];
const projectDefinitions = [
  { id: "project-text", name: "Summary", dataType: "TEXT" },
  { id: "project-number", name: "Points", dataType: "NUMBER" },
  { id: "project-date", name: "Due date", dataType: "DATE" },
  {
    id: "project-select",
    name: "Status",
    dataType: "SINGLE_SELECT",
    options: [{ id: "option-todo", name: "Todo" }],
  },
  {
    id: "project-iteration",
    name: "Iteration",
    dataType: "ITERATION",
    configuration: {
      iterations: [
        {
          id: "iteration-1",
          title: "Iteration 1",
          startDate: "2026-10-20",
          duration: 14,
        },
      ],
      completedIterations: [],
    },
  },
  { id: "project-users", name: "Reviewers", dataType: "ASSIGNEES" },
];
const page = (nodes: unknown[], cursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
});
function projectPage(
  fields: ReturnType<typeof page> | undefined,
  values: ReturnType<typeof page> | undefined,
) {
  return {
    data: {
      project: { id: "project-A", ...(fields ? { fields } : {}) },
      item: {
        id: "item-42",
        project: { id: "project-A" },
        content: { id: "fixture-issue-42" },
        ...(values ? { fieldValues: values } : {}),
      },
    },
  };
}

function setup(
  overrides: {
    service?: GitHubService;
    commentIssue?: number;
    reactionAuthor?: string;
    projectContentId?: string;
    fieldDefinitions?: unknown[];
    writeError?: boolean;
    projectRead?: (variables: Record<string, unknown>) => unknown;
  } = {},
) {
  const service = overrides.service ?? createFixtureService();
  const run = vi.fn<GhRunner>(async (args, input) => {
    const endpoint = args[3];
    const method = args[args.indexOf("--method") + 1];
    const body = input
      ? z.record(z.string(), z.unknown()).parse(JSON.parse(input))
      : {};
    const isMutation =
      method !== "GET" &&
      !(
        endpoint === "graphql" &&
        typeof body.query === "string" &&
        body.query.startsWith("query")
      );
    if (isMutation && overrides.writeError)
      throw new Error("token=never-display");
    if (endpoint === "graphql") {
      const query = String(body.query);
      if (query.includes("ArcoProjectFields")) {
        if (overrides.projectRead)
          return overrides.projectRead(
            z.record(z.string(), z.unknown()).parse(body.variables),
          );
        return {
          data: {
            project: { id: "project-A", fields: page(projectDefinitions) },
            item: {
              id: "item-42",
              project: { id: "project-A" },
              content: { id: overrides.projectContentId ?? "fixture-issue-42" },
              fieldValues: page([
                {
                  __typename: "ProjectV2ItemFieldNumberValue",
                  number: 0,
                  field: { id: "project-number" },
                },
              ]),
            },
          },
        };
      }
      if (query.includes("ArcoIssueMemberships"))
        return {
          data: {
            repository: {
              issue: {
                id: "fixture-issue-42",
                projectItems: page([
                  {
                    id: "item-42",
                    project: {
                      id: "project-A",
                      title: "Project A",
                      url: "https://github.com/users/yu/projects/1",
                    },
                  },
                ]),
              },
            },
          },
        };
      if (query.includes("ArcoProjectIdentity"))
        return { data: { node: { id: "project-A" } } };
      if (query.includes("ArcoAddProject"))
        return { data: { addProjectV2ItemById: { item: { id: "item-42" } } } };
      if (query.includes("ArcoProjects"))
        return {
          data: {
            user: {
              projectsV2: page([
                {
                  id: "project-A",
                  title: "Project A",
                  url: "https://github.com/users/yu/projects/1",
                  closed: false,
                },
              ]),
            },
          },
        };
      return { data: {} };
    }
    if (method !== "GET") {
      if (endpoint?.endsWith("/issues/comments/101") && method === "PATCH")
        return {
          id: 101,
          node_id: "IC_101",
          issue_url: `https://api.github.com/repos/${FIXTURE_REPO}/issues/42`,
          updated_at: "2026-10-22T01:00:00Z",
          body: body.body,
          html_url: `https://github.com/${FIXTURE_REPO}/issues/42#issuecomment-101`,
          user: { login: "fixture-user" },
        };
      if (endpoint?.startsWith(`repos/${FIXTURE_REPO}/labels`))
        return {
          id: 1,
          name: "new/name",
          color: "aabbcc",
          description: "Definition",
        };
      return null;
    }
    if (endpoint === `repos/${FIXTURE_REPO}`)
      return {
        full_name: FIXTURE_REPO,
        owner: { login: "yu", type: "Organization" },
      };
    if (endpoint?.endsWith("/issues/comments/101"))
      return {
        id: 101,
        issue_url: `https://api.github.com/repos/${FIXTURE_REPO}/issues/${overrides.commentIssue ?? 42}`,
        updated_at: "2026-10-22T00:00:00Z",
      };
    if (endpoint?.includes("/reactions?"))
      return [
        [
          {
            id: 201,
            content: "heart",
            user: { login: overrides.reactionAuthor ?? "fixture-user" },
          },
        ],
      ];
    if (endpoint === "orgs/yu/issue-fields")
      return overrides.fieldDefinitions ?? fields;
    if (endpoint?.endsWith("/issue-field-values?per_page=100"))
      return [
        [
          { issue_field_id: 12, value: "Keep text" },
          { issue_field_id: 13, value: 0 },
        ],
      ];
    if (endpoint === "orgs/yu/issue-types")
      return [{ id: 5, name: "Bug", description: "Existing bug type" }];
    if (endpoint?.includes("/milestones?"))
      return [[{ number: 1, title: "Existing milestone", state: "open" }]];
    if (endpoint?.endsWith("/labels?per_page=100"))
      return [[{ id: 1, name: "keep", color: "eeeeee", description: null }]];
    if (endpoint?.endsWith("/parent"))
      throw new GitHubError("Not found", "not-found");
    if (
      endpoint?.includes("/sub_issues?") ||
      endpoint?.includes("/dependencies/blocking?")
    )
      return [[]];
    if (endpoint?.includes("/dependencies/blocked_by?"))
      return [[rawIssue(43)]];
    const issueNumber = /\/issues\/(\d+)$/.exec(endpoint ?? "")?.[1];
    if (issueNumber) return rawIssue(Number(issueNumber));
    throw new Error(`Unhandled fixture endpoint ${endpoint}`);
  });
  const operations = createGitHubOperations({ service, run });
  const writes = () =>
    run.mock.calls.filter(
      ([args, input]) =>
        args[args.indexOf("--method") + 1] !== "GET" &&
        !(args[3] === "graphql" && input?.includes('"query":"query')),
    );
  return { operations, run, writes, service };
}

describe("explicit additional GitHub operations", () => {
  it("edits a label definition with encoded original name and JSON new_name, distinct from unassigning", async () => {
    const { operations, run } = setup();
    await operations.updateLabel({
      repo: FIXTURE_REPO,
      requestId: "rename-definition",
      name: "old/name",
      patch: { name: "new/name", color: "aabbcc" },
    });
    const [args, input] = run.mock.calls[0];
    expect(args[3]).toBe(`repos/${FIXTURE_REPO}/labels/old%2Fname`);
    expect(JSON.parse(input ?? "")).toEqual({
      new_name: "new/name",
      color: "aabbcc",
    });
    expect(args.some((arg) => arg.includes("/issues/"))).toBe(false);
    await operations.deleteLabel({
      repo: FIXTURE_REPO,
      requestId: "delete-definition",
      name: "old/name",
    });
    expect(run.mock.calls[1][0]).toContain("DELETE");
  });

  it("deduplicates a concurrent label definition create and refuses changed content under the same ID", async () => {
    const { operations, writes } = setup();
    const input = {
      repo: FIXTURE_REPO,
      requestId: "create-definition",
      name: "new/name",
      color: "aabbcc",
      description: "Definition",
    };
    await Promise.all([
      operations.createLabel(input),
      operations.createLabel(input),
    ]);
    expect(writes()).toHaveLength(1);
    await expect(
      operations.createLabel({ ...input, color: "000000" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("retains a saved label when its response cannot be parsed", async () => {
    const { operations, run } = setup();
    run.mockResolvedValueOnce({});
    const input = {
      repo: FIXTURE_REPO,
      requestId: "saved-label-unreadable",
      name: "new-label",
      color: "aabbcc",
      description: "Saved before the response failed validation",
    };
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(operations.createLabel(input)).rejects.toMatchObject({
        code: "refresh",
        message: expect.stringContaining("saved to GitHub"),
      });
    expect(run).toHaveBeenCalledOnce();
  });

  it("reports saved attributes when their verification read fails and does not repeat the PATCH", async () => {
    const { run: base, service } = setup();
    let saved = false;
    const run = vi.fn<GhRunner>(async (args, input) => {
      if (args.includes("PATCH")) saved = true;
      else if (saved && args[3]?.endsWith("/issues/42"))
        throw new GitHubError("Verification unavailable", "unavailable");
      return base(args, input);
    });
    const operations = createGitHubOperations({ service, run });
    const input = {
      ...ref,
      requestId: "saved-attributes-read-failed",
      patch: { milestoneNumber: 1 },
    };
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(operations.issueAttributes(input)).rejects.toMatchObject({
        code: "refresh",
        message: expect.stringContaining("saved to GitHub"),
      });
    expect(
      run.mock.calls.filter(([args]) => args.includes("PATCH")),
    ).toHaveLength(1);
  });

  it("rejects a comment that belongs to another Issue before editing or deleting", async () => {
    const { operations, writes } = setup({ commentIssue: 43 });
    await expect(
      operations.editComment({
        ...ref,
        requestId: "foreign-comment-edit",
        commentId: 101,
        body: "Do not edit",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      operations.deleteComment({
        ...ref,
        requestId: "foreign-comment-delete",
        commentId: 101,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(writes()).toHaveLength(0);
  });

  it("detects comment version conflicts and keeps user text out of argv", async () => {
    const { operations, writes } = setup();
    await expect(
      operations.editComment({
        ...ref,
        requestId: "stale-comment-edit",
        commentId: 101,
        body: "Draft",
        expectedUpdatedAt: "stale",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const edited = await operations.editComment({
      ...ref,
      requestId: "fresh-comment-edit",
      commentId: 101,
      body: "@file\n$(never)",
    });
    expect("changedComment" in edited && edited.changedComment).toMatchObject({
      databaseId: 101,
      body: "@file\n$(never)",
      updatedAt: "2026-10-22T01:00:00Z",
    });
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).not.toContain("@file\n$(never)");
    expect(JSON.parse(writes()[0][1] ?? "")).toEqual({
      body: "@file\n$(never)",
    });
  });

  it("keeps issue and comment reaction targets separate and refuses cancelling another author", async () => {
    const { operations, writes } = setup();
    await operations.addReaction({
      ...ref,
      requestId: "issue-reaction-add",
      content: "heart",
    });
    await operations.addReaction({
      ...ref,
      requestId: "comment-reaction-add",
      commentId: 101,
      content: "eyes",
    });
    expect(writes().map(([args]) => args[3])).toEqual([
      `repos/${FIXTURE_REPO}/issues/42/reactions`,
      `repos/${FIXTURE_REPO}/issues/comments/101/reactions`,
    ]);
    const other = setup({ reactionAuthor: "another-user" });
    await expect(
      other.operations.removeReaction({
        ...ref,
        requestId: "reaction-other-author",
        reactionId: 201,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(other.writes()).toHaveLength(0);
  });

  it("changes exactly one organization Issue field by POST and preserves zero and unrelated values", async () => {
    const { operations, writes } = setup();
    expect(
      (await operations.issueFields(ref)).fields.find(
        (field) => field.id === 13,
      )?.value,
    ).toBe(0);
    await operations.setIssueField({
      ...ref,
      requestId: "issue-one-field",
      fieldId: 13,
      value: 7,
    });
    expect(writes()[0][0]).toContain("POST");
    expect(JSON.parse(writes()[0][1] ?? "")).toEqual({
      issue_field_values: [{ field_id: 13, value: 7 }],
    });
    expect(writes()[0][0]).not.toContain("PUT");
  });

  it("removes only the selected organization Issue field rather than clearing all values", async () => {
    const { operations, writes } = setup();
    await operations.setIssueField({
      ...ref,
      requestId: "issue-remove-field",
      fieldId: 12,
      value: null,
    });
    expect(writes()[0][0][3]).toBe(
      `repos/${FIXTURE_REPO}/issues/42/issue-field-values/12`,
    );
    expect(writes()[0][0]).toContain("DELETE");
  });

  it("validates fixed Issue field types, existing option names and valid calendar dates", async () => {
    const { operations, writes } = setup();
    const invalidCases: [number, FieldValue][] = [
      [13, "7"],
      [14, "2026-02-30"],
      [15, "unknown"],
      [16, ["unknown"]],
      [17, "person"],
      [999, "foreign-project-field"],
    ];
    for (const [fieldId, value] of invalidCases) {
      await expect(
        operations.setIssueField({
          ...ref,
          requestId: `reject-${fieldId}`,
          fieldId,
          value,
        }),
      ).rejects.toMatchObject({ code: "invalid" });
    }
    await operations.setIssueField({
      ...ref,
      requestId: "valid-multi-select",
      fieldId: 16,
      value: ["Frontend", "Backend"],
    });
    expect(JSON.parse(writes()[0][1] ?? "")).toEqual({
      issue_field_values: [{ field_id: 16, value: ["Frontend", "Backend"] }],
    });
  });

  it("uses Project field and option IDs, distinct from organization field IDs and option names", async () => {
    const { operations, writes } = setup();
    const projectRef = { ...ref, projectId: "project-A", itemId: "item-42" };
    expect(
      (await operations.projectFields(projectRef)).fields.find(
        (field) => field.id === "project-number",
      )?.value,
    ).toBe(0);
    await expect(
      operations.setProjectField({
        ...projectRef,
        requestId: "reject-project-name",
        fieldId: "project-select",
        value: "Todo",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      operations.setProjectField({
        ...projectRef,
        requestId: "reject-org-field-id",
        fieldId: "15",
        value: "High",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await operations.setProjectField({
      ...projectRef,
      requestId: "valid-project-id",
      fieldId: "project-select",
      value: "option-todo",
    });
    const body = JSON.parse(writes()[0][1] ?? "");
    expect(body.variables).toEqual({
      projectId: "project-A",
      itemId: "item-42",
      fieldId: "project-select",
      value: { singleSelectOptionId: "option-todo" },
    });
  });

  it("loads 101 fields across two definition pages and three independent value pages before editing the last field", async () => {
    const firstFields = Array.from({ length: 100 }, (_, index) => ({
      id: `field-${index + 1}`,
      name: `Field ${index + 1}`,
      dataType: index === 0 ? "NUMBER" : "TEXT",
    }));
    const firstValues = [
      {
        __typename: "ProjectV2ItemFieldNumberValue",
        field: { id: "field-1" },
        number: 0,
      },
    ];
    const middleValues = firstFields.slice(1).map((field) => ({
      __typename: "ProjectV2ItemFieldTextValue",
      field: { id: field.id },
      text: `Value for ${field.id}`,
    }));
    const requested: Record<string, unknown>[] = [];
    const { operations, writes } = setup({
      projectRead: (variables) => {
        requested.push(variables);
        return projectPage(
          variables.includeFields
            ? variables.fieldsCursor === null
              ? page(firstFields, "fields-1")
              : page([projectDefinitions[3]])
            : undefined,
          variables.includeValues
            ? variables.valuesCursor === null
              ? page(firstValues, "values-1")
              : variables.valuesCursor === "values-1"
                ? page(middleValues, "values-2")
                : page([
                    {
                      __typename: "ProjectV2ItemFieldSingleSelectValue",
                      field: { id: "project-select" },
                      optionId: "option-todo",
                    },
                  ])
            : undefined,
        );
      },
    });
    const projectRef = { ...ref, projectId: "project-A", itemId: "item-42" };
    const result = await operations.projectFields(projectRef);
    expect(result.hasMore).toBe(false);
    expect(result.fields).toHaveLength(101);
    expect(result.fields[0]!.value).toBe(0);
    expect(result.fields.at(-1)).toMatchObject({
      id: "project-select",
      value: "option-todo",
    });
    expect(
      requested.map(
        ({ fieldsCursor, valuesCursor, includeFields, includeValues }) => ({
          fieldsCursor,
          valuesCursor,
          includeFields,
          includeValues,
        }),
      ),
    ).toEqual([
      {
        fieldsCursor: null,
        valuesCursor: null,
        includeFields: true,
        includeValues: true,
      },
      {
        fieldsCursor: "fields-1",
        valuesCursor: "values-1",
        includeFields: true,
        includeValues: true,
      },
      {
        fieldsCursor: null,
        valuesCursor: "values-2",
        includeFields: false,
        includeValues: true,
      },
    ]);
    await operations.setProjectField({
      ...projectRef,
      requestId: "page-101-save",
      fieldId: "project-select",
      value: "option-todo",
    });
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1]!).variables).toMatchObject({
      fieldId: "project-select",
      value: { singleSelectOptionId: "option-todo" },
    });
  });

  it.each([
    "transport",
    "graphql",
    "schema",
    "project",
    "item",
    "item-project",
    "issue",
    "values",
  ])(
    "stops a Project field write when a later page fails its %s check",
    async (failure) => {
      let reads = 0;
      const { operations, writes } = setup({
        projectRead: () => {
          if (++reads === 1)
            return projectPage(
              page(
                [projectDefinitions[0]],
                failure === "values" ? null : "next-fields",
              ),
              page([], failure === "values" ? "next-values" : null),
            );
          if (failure === "transport") throw new Error("Unavailable");
          if (failure === "graphql" || failure === "values")
            return { errors: [{ message: "Denied" }] };
          if (failure === "schema") return { data: null };
          const response = projectPage(page([]), undefined);
          if (failure === "project") response.data.project.id = "other-project";
          if (failure === "item") response.data.item.id = "other-item";
          if (failure === "item-project")
            response.data.item.project.id = "other-project";
          if (failure === "issue")
            response.data.item.content.id = "other-issue";
          return response;
        },
      });
      await expect(
        operations.setProjectField({
          ...ref,
          projectId: "project-A",
          itemId: "item-42",
          requestId: `failed-page-${failure}`,
          fieldId: "project-text",
          value: "Must not be written",
        }),
      ).rejects.toThrow();
      expect(reads).toBe(2);
      expect(writes()).toHaveLength(0);
    },
  );

  it.each([
    { label: "missing", cursors: [null] },
    { label: "empty", cursors: [""] },
    { label: "repeated", cursors: ["a", "a"] },
    { label: "cyclic", cursors: ["a", "b", "a"] },
  ])(
    "rejects $label cursors on either Project connection before writing",
    async ({ cursors, label }) => {
      for (const connection of ["fields", "values"] as const) {
        let reads = 0;
        const { operations, writes } = setup({
          projectRead: () => {
            const cursor = cursors[reads++];
            const incomplete = {
              ...page(connection === "fields" ? [projectDefinitions[0]] : []),
              pageInfo: { hasNextPage: true, endCursor: cursor },
            };
            return projectPage(
              connection === "fields"
                ? incomplete
                : page([projectDefinitions[0]]),
              connection === "values" ? incomplete : page([]),
            );
          },
        });
        await expect(
          operations.setProjectField({
            ...ref,
            projectId: "project-A",
            itemId: "item-42",
            requestId: `${connection}-${label}-cursor`,
            fieldId: "project-text",
            value: "Must not be written",
          }),
        ).rejects.toThrow("pagination did not advance");
        expect(reads).toBe(cursors.length);
        expect(writes()).toHaveLength(0);
      }
    },
  );

  it("deduplicates identical page entries but refuses conflicting field definitions or values", async () => {
    for (const changed of [false, "definition", "value"] as const) {
      let reads = 0;
      const { operations } = setup({
        projectRead: () => {
          const second = ++reads > 1;
          return projectPage(
            page(
              [
                {
                  ...projectDefinitions[0],
                  ...(second && changed === "definition"
                    ? { name: "Changed" }
                    : {}),
                },
              ],
              second ? null : "next-fields",
            ),
            page(
              [
                {
                  __typename: "ProjectV2ItemFieldTextValue",
                  field: { id: "project-text" },
                  text:
                    second && changed === "value"
                      ? "Changed value"
                      : "Original value",
                },
              ],
              second ? null : "next-values",
            ),
          );
        },
      });
      const reading = operations.projectFields({
        ...ref,
        projectId: "project-A",
        itemId: "item-42",
      });
      if (changed)
        await expect(reading).rejects.toThrow("data changed while loading");
      else expect((await reading).fields).toHaveLength(1);
    }
  });

  it("rejects a Project item belonging to another Issue and unsupported field types", async () => {
    const mismatch = setup({ projectContentId: "fixture-issue-43" });
    await expect(
      mismatch.operations.setProjectField({
        ...ref,
        requestId: "foreign-project-item",
        projectId: "project-A",
        itemId: "item-42",
        fieldId: "project-text",
        value: "text",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(mismatch.writes()).toHaveLength(0);
    const current = setup();
    await expect(
      current.operations.setProjectField({
        ...ref,
        requestId: "unsupported-project-type",
        projectId: "project-A",
        itemId: "item-42",
        fieldId: "project-users",
        value: "person",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("lists Project membership independently of whether the Project has a Status field", async () => {
    const { operations } = setup();
    expect((await operations.issueProjects(ref)).memberships).toEqual([
      {
        projectId: "project-A",
        itemId: "item-42",
        title: "Project A",
        url: "https://github.com/users/yu/projects/1",
      },
    ]);
  });

  it("requires exact Issue/Project/item membership before removing from a Project", async () => {
    const { operations, writes } = setup();
    await expect(
      operations.projectMembership({
        ...ref,
        requestId: "project-remove-wrong",
        projectId: "project-A",
        itemId: "item-43",
        action: "remove",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await operations.projectMembership({
      ...ref,
      requestId: "project-remove-right",
      projectId: "project-A",
      itemId: "item-42",
      action: "remove",
    });
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1] ?? "").variables.itemId).toBe("item-42");
  });

  it("retains ambiguous failed writes without replaying on the same request ID", async () => {
    const { operations, writes } = setup({ writeError: true });
    const input = {
      ...ref,
      requestId: "failed-reaction-once",
      content: "heart" as const,
    };
    await expect(operations.addReaction(input)).rejects.toMatchObject({
      code: "uncertain",
    });
    await expect(operations.addReaction(input)).rejects.not.toThrow(
      "token=never-display",
    );
    expect(writes()).toHaveLength(1);
  });

  it("uses numeric source IDs for parent/dependency writes and disallows self-parenting", async () => {
    const { operations, writes } = setup();
    await expect(
      operations.setParent({
        ...ref,
        requestId: "self-parent",
        parent: ref,
        replace: false,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await operations.setParent({
      ...ref,
      requestId: "valid-parent",
      parent: { ...ref, number: 43 },
      replace: true,
    });
    await operations.addDependency({
      ...ref,
      requestId: "valid-dependency",
      blockedBy: { ...ref, number: 43 },
    });
    expect(JSON.parse(writes()[0][1] ?? "")).toEqual({
      sub_issue_id: 42,
      replace_parent: true,
    });
    expect(writes()[0][0][3]).toBe(
      `repos/${FIXTURE_REPO}/issues/43/sub_issues`,
    );
    expect(JSON.parse(writes()[1][1] ?? "")).toEqual({ issue_id: 43 });
  });

  it("keeps a created child identifiable when linking it to the parent fails", async () => {
    const { operations, service } = setup({ writeError: true });
    const input = {
      ...ref,
      requestId: "create-child-partial",
      childRepo: FIXTURE_REPO,
      title: "Created child",
      body: "Keep me",
    };
    await expect(operations.createSubIssue(input)).rejects.toThrow(
      "yu/Arco #44",
    );
    await expect(operations.createSubIssue(input)).rejects.toMatchObject({
      code: "partial",
    });
    expect(
      (
        await service.list({
          repo: FIXTURE_REPO,
          query: "Created child",
          state: "all",
          page: 1,
        })
      ).issues,
    ).toHaveLength(1);
  });

  it("keeps bulk outcomes per Issue, rejects mixed repo scopes, and never retries completed members", async () => {
    const service = createFixtureService();
    const update = vi
      .spyOn(service, "update")
      .mockImplementation(async (input) => {
        if (input.number === 43)
          throw new GitHubError("No permission for #43", "forbidden");
        return { ...(await service.get(input)), state: "closed" };
      });
    const { operations } = setup({ service });
    const input = {
      requestId: "bulk-state-once",
      issues: [ref, { ...ref, number: 43 }],
      patch: { state: "closed" as const },
    };
    const result = await operations.bulkUpdate(input);
    expect(result).toMatchObject({
      results: [
        { number: 42, ok: true },
        { number: 43, ok: false },
      ],
    });
    await operations.bulkUpdate(input);
    expect(update).toHaveBeenCalledTimes(2);
    await expect(
      operations.bulkUpdate({
        ...input,
        requestId: "bulk-mixed-scopes",
        issues: [ref, { repo: "other/repo", number: 1 }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("reuses the last bulk mutation's detail result without fetching it again", async () => {
    const service = createFixtureService();
    const original = await service.get(ref);
    const afterState = { ...original, state: "closed" as const };
    const afterLabels = { ...afterState, labels: [] };
    const get = vi.spyOn(service, "get");
    vi.spyOn(service, "update").mockResolvedValue(afterState);
    vi.spyOn(service, "labels").mockResolvedValue(afterLabels);
    const { operations } = setup({ service });
    const result = await operations.bulkUpdate({
      requestId: "bulk-reuse-latest-detail",
      issues: [ref],
      patch: { state: "closed" },
      labels: { add: [], remove: ["bug"] },
    });
    expect(result).toEqual({
      results: [{ ...ref, ok: true, issue: afterLabels }],
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("validates tool boundaries before any command is launched", async () => {
    const { operations, run } = setup();
    await expect(
      callGitHubOperation(operations, "arco_create_label", {
        repo: FIXTURE_REPO,
        requestId: "invalid-color",
        name: "label",
        color: "javascript:",
      }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it("never falls back from an explicit fixture service into the live gh CLI", async () => {
    const operations = createGitHubOperations({
      service: createFixtureService(),
    });
    await expect(
      operations.labelDefinitions({ repo: FIXTURE_REPO }),
    ).rejects.toMatchObject({ code: "fixture" });
  });
});

describe("template fidelity", () => {
  it("inherits only public owner .github templates when the selected repository has no local directory", async () => {
    const source =
      "---\nname: Shared bug report\nabout: Existing account default\nlabels: bug\n---\n## Reproduction\n";
    const localDirectory = `repos/${FIXTURE_REPO}/contents/.github/ISSUE_TEMPLATE`;
    const defaultRepo = "yu/.github";
    const defaultDirectory = `repos/${defaultRepo}/contents/.github/ISSUE_TEMPLATE`;
    const file = {
      name: "bug.md",
      path: ".github/ISSUE_TEMPLATE/bug.md",
      html_url: null,
      type: "file",
    };
    let localPresent = false;
    let defaultPrivate = false;
    const run = vi.fn<GhRunner>(async (args) => {
      if (args[3] === localDirectory) {
        if (localPresent)
          return [
            {
              name: "config.yml",
              path: ".github/ISSUE_TEMPLATE/config.yml",
              html_url: null,
              type: "file",
            },
          ];
        throw new GitHubError("Not found", "not-found");
      }
      if (args[3] === `repos/${defaultRepo}`)
        return { full_name: defaultRepo, private: defaultPrivate };
      if (args[3] === defaultDirectory) return [file];
      if (args[3] === `${defaultDirectory}/bug.md`)
        return {
          content: Buffer.from(source).toString("base64"),
          encoding: "base64",
        };
      throw new Error("Unexpected template request");
    });
    const inherited = createGitHubOperations({
      service: createFixtureService(),
      run,
    });
    const result = await inherited.issueTemplates({ repo: FIXTURE_REPO });
    expect(result).toMatchObject({
      repo: FIXTURE_REPO,
      templates: [
        {
          name: "Shared bug report",
          kind: "simple",
          body: "## Reproduction\n",
          defaults: { labels: ["bug"] },
          url: `https://github.com/${FIXTURE_REPO}/issues/new/choose`,
        },
      ],
    });
    expect(
      run.mock.calls.some(([args]) => args[3] === `${localDirectory}/bug.md`),
    ).toBe(false);
    defaultPrivate = true;
    expect(
      (await inherited.issueTemplates({ repo: FIXTURE_REPO })).templates,
    ).toEqual([]);
    localPresent = true;
    const callsBefore = run.mock.calls.length;
    expect(
      (await inherited.issueTemplates({ repo: FIXTURE_REPO })).templates,
    ).toEqual([]);
    expect(run.mock.calls.slice(callsBefore).map(([args]) => args[3])).toEqual([
      localDirectory,
    ]);
  });

  it("returns exact Markdown and supported defaults only for simple flat templates", () => {
    const template = classifyMarkdownTemplate(
      ".github/ISSUE_TEMPLATE/bug.md",
      '---\nname: Bug report\nabout: A reproducible problem\ntitle: "[Bug] "\nlabels: bug, design\nassignees: fixture-user\ntype: Bug\n---\n## Steps\n\n- [ ] Reproduce\n',
      "https://github.com/yu/Arco/issues/new/choose",
    );
    expect(template).toMatchObject({
      kind: "simple",
      name: "Bug report",
      body: "## Steps\n\n- [ ] Reproduce\n",
      defaults: {
        title: "[Bug] ",
        type: "Bug",
        labels: ["bug", "design"],
        assignees: ["fixture-user"],
      },
    });
  });

  it("hands forms, unknown attributes, required behaviors, anchors and complex YAML to GitHub intact", () => {
    for (const metadata of [
      "name: Bug\nprojects: [1]",
      "name: Bug\nbody:\n  - type: input",
      "name: Bug\nlabels: [bug]",
      "name: &template Bug",
      "name: Bug\nrequired: true",
      "name: Bug\nname: Another",
      "name: false",
    ]) {
      const template = classifyMarkdownTemplate(
        "bug.md",
        `---\n${metadata}\n---\nBody`,
        "https://github.com/yu/Arco/issues/new/choose",
      );
      expect(template.kind).toBe("unsupported");
      expect(template.body).toBeUndefined();
      expect(template.defaults).toBeUndefined();
      expect(template.url).toContain("/issues/new/choose");
    }
  });
});
