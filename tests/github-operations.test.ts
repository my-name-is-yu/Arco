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
const page = (nodes: unknown[]) => ({
  nodes,
  pageInfo: { hasNextPage: false, endCursor: null },
});

function setup(
  overrides: {
    service?: GitHubService;
    commentIssue?: number;
    reactionAuthor?: string;
    projectContentId?: string;
    fieldDefinitions?: unknown[];
    writeError?: boolean;
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
      if (query.includes("ArcoProjectFields"))
        return {
          data: {
            project: { id: "project-A", fields: page(projectDefinitions) },
            item: {
              id: "item-42",
              project: { id: "project-A" },
              content: { id: overrides.projectContentId ?? "fixture-issue-42" },
              fieldValues: page([
                { number: 0, field: { id: "project-number" } },
              ]),
            },
          },
        };
      if (query.includes("ArcoIssueMemberships"))
        return {
          data: {
            repository: {
              issue: {
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
    await operations.editComment({
      ...ref,
      requestId: "fresh-comment-edit",
      commentId: 101,
      body: "@file\n$(never)",
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
