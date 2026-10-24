import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LinearClient } from "@linear/sdk";
import { createLinearAuth } from "../src/server/linear/auth";
import { createLinearService } from "../src/server/linear/service";
import type {
  LinearCommentPage,
  LinearIssue,
  LinearPage,
} from "../src/shared/linear";

const scope = {
  connectionId: "sdk-test",
  workspaceId: "workspace",
  teamId: "team",
};
const ref = { ...scope, issueId: "issue" };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const connection = (nodes: unknown[], hasMore = false) => ({
  nodes,
  pageInfo: {
    hasNextPage: hasMore,
    endCursor: hasMore ? "page-2" : null,
    hasPreviousPage: false,
    startCursor: null,
  },
});

async function source() {
  const directory = await mkdtemp(join(tmpdir(), "arco-linear-sdk-test-"));
  const auth = createLinearAuth({
    directory,
    store: {
      async read() {
        return {
          clientId: "fake-public-client",
          accessToken: "fake-sdk-token",
          refreshToken: "fake-refresh",
          expiresAt: Date.now() + 86_400_000,
          scopes: ["read", "write"],
        };
      },
      async write() {},
      async remove() {},
    },
  });
  const issue = {
    id: "issue",
    identifier: "TST-1",
    title: "Source title",
    description: "Source description",
    url: "https://linear.app/fixture/issue/TST-1",
    updatedAt: "2026-10-23T00:00:00.000Z",
    team: { id: "team" },
    state: { id: "state" },
    creator: { id: "user" },
    assignee: { id: "user" },
    labelIds: ["existing"],
    priority: 2,
    reactions: [],
    sharedAccess: {
      isShared: false,
      sharedWithCount: 0,
      viewerHasOnlySharedAccess: false,
      disallowedIssueFields: [],
      sharedWithUsers: [],
    },
  };
  const calls: {
    operation: string;
    variables: Record<string, unknown>;
    bearer: boolean;
    query: string;
  }[] = [];
  const controls = {
    partialError: false,
    relations: false,
    failAfterCreate: "" as "" | "issue" | "comment",
    failIssueRead: false,
    failAfterUpdate: false,
    failProjects: false,
    rejectUpdate: false,
    mutationSuccess: true as unknown,
    commentCount: 0,
    commentIssueId: "issue",
  };
  const sourceComment = (id: string) => ({
    id,
    body: "![Source image](https://uploads.linear.app/workspace/image.png)",
    issueId: controls.commentIssueId,
    issue: { id: controls.commentIssueId },
    parentId: "unloaded-parent",
    updatedAt: "2026-10-23T00:00:00.000Z",
    createdAt: "2026-10-23T00:00:00.000Z",
    url: `https://linear.app/fixture/issue/TST-1#${id}`,
    reactions: [],
    reactionData: {},
  });
  const server: Server = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body) as {
        query: string;
        variables: Record<string, unknown>;
      };
      const operation =
        /(?:query|mutation)\s+(\w+)/.exec(input.query)?.[1] ?? "unknown";
      calls.push({
        operation,
        variables: input.variables,
        bearer: request.headers.authorization === "Bearer fake-sdk-token",
        query: input.query,
      });
      if (operation === "updateIssue" && controls.rejectUpdate) {
        response.statusCode = 403;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ errors: [{ message: "Forbidden" }] }));
        return;
      }
      const organization = {
        id: "workspace",
        urlKey: "fixture",
        name: "Test workspace",
        projectStatuses: [],
      };
      const team = {
        id:
          typeof input.variables.id === "string" ? input.variables.id : "team",
        name: "Test team",
        key: "TST",
        inheritIssueEstimation: false,
        inheritWorkflowStatuses: false,
        issueEstimationType: "fibonacci",
        issueEstimationAllowZero: true,
        issueEstimationExtended: false,
      };
      const label = (id: string) => ({
        id,
        name: id,
        color: "#eeeeee",
        isGroup: false,
      });
      let data: object;
      switch (operation) {
        case "ArcoLinearIssueList":
        case "ArcoLinearIssueSearch":
          data = {
            organization,
            team: { ...team, organization: { id: "workspace" } },
            issuePage: connection(
              [
                {
                  ...issue,
                  state: {
                    id: "state",
                    name: "In progress",
                    type: "started",
                    color: "#ffcc00",
                  },
                },
              ],
              true,
            ),
          };
          break;
        case "organization":
          data = { organization };
          break;
        case "team":
          data = { team };
          break;
        case "issue":
          if (controls.failIssueRead)
            throw new Error("Simulated source readback failure");
          data = {
            issue:
              input.variables.id === "issue" || input.variables.id === "TST-1"
                ? issue
                : {
                    ...issue,
                    id: input.variables.id,
                    identifier:
                      input.variables.id === "blocked" ? "TST-2" : "TST-3",
                    title: `Related ${input.variables.id}`,
                  },
          };
          break;
        case "comment":
          data = { comment: sourceComment(String(input.variables.id)) };
          break;
        case "user":
          data = { user: { id: "user", name: "Test user" } };
          break;
        case "workflowState":
          data = {
            workflowState: {
              id: "state",
              name: "In progress",
              type: "started",
              color: "#ffcc00",
            },
          };
          break;
        case "issue_labels":
          data = { issue: { labels: connection(issue.labelIds.map(label)) } };
          break;
        case "issue_comments": {
          const start = input.variables.after
            ? Number(String(input.variables.after).replace("comment-", "")) + 1
            : 0;
          const count = Number(input.variables.first ?? 100);
          const comments = Array.from(
            {
              length: Math.min(
                count,
                Math.max(0, controls.commentCount - start),
              ),
            },
            (_, index) => sourceComment(`comment-${start + index}`),
          );
          data = {
            issue: {
              comments: {
                ...connection(
                  comments,
                  start + comments.length < controls.commentCount,
                ),
                pageInfo: {
                  hasNextPage: start + comments.length < controls.commentCount,
                  endCursor: comments.at(-1)?.id ?? null,
                  hasPreviousPage: start > 0,
                  startCursor: comments[0]?.id ?? null,
                },
              },
            },
          };
          break;
        }
        case "organization_templates":
          data = {
            organization: {
              templates: connection([
                {
                  id: "template",
                  name: "Simple template",
                  type: "issue",
                  content: "Default template description",
                  templateData: JSON.stringify({
                    title: "Default title",
                    priority: 3,
                  }),
                },
              ]),
            },
          };
          break;
        case "team_templates":
          data = { team: { templates: connection([]) } };
          break;
        case "createIssue": {
          const create = input.variables.input as {
            title: string;
            description?: string;
            templateId?: string;
          };
          issue.title = create.title;
          issue.description =
            create.description ??
            (create.templateId ? "Default template description" : "");
          data = { issueCreate: { success: true, issue: { id: issue.id } } };
          controls.failIssueRead = controls.failAfterCreate === "issue";
          break;
        }
        case "createComment":
          data = {
            commentCreate: {
              success: controls.mutationSuccess,
              comment: { id: "created-comment" },
            },
          };
          controls.failIssueRead = controls.failAfterCreate === "comment";
          break;
        case "fileUpload":
          data = {
            fileUpload: {
              success: true,
              uploadFile: {
                uploadUrl: "http://uploads.invalid/test",
                assetUrl: "https://uploads.invalid/test",
                headers: [],
              },
            },
          };
          break;
        case "organization_labels":
          data = {
            organization: {
              labels: connection([label("existing"), label("added")]),
            },
          };
          break;
        case "team_labels":
          data = { team: { labels: connection([]) } };
          break;
        case "team_states":
          data = {
            team: {
              states: connection([
                {
                  id: "state",
                  name: "In progress",
                  type: "started",
                  color: "#ffcc00",
                },
                {
                  id: "duplicate",
                  name: "Duplicate",
                  type: "duplicate",
                  color: "#888888",
                },
              ]),
            },
          };
          break;
        case "team_members":
          data = {
            team: { members: connection([{ id: "user", name: "Test user" }]) },
          };
          break;
        case "team_projects":
          if (controls.failProjects)
            throw new Error("Simulated project catalog failure");
          data = { team: { projects: connection([]) } };
          break;
        case "team_cycles":
          data = { team: { cycles: connection([]) } };
          break;
        case "issues":
          data = { issues: connection([issue], true) };
          break;
        case "searchIssues":
          data = {
            searchIssues: {
              ...connection([issue], true),
              totalCount: 2,
              archivePayload: {
                archive: "{}",
                totalCount: 0,
                databaseVersion: 1,
                includesDependencies: false,
              },
            },
          };
          break;
        case "updateIssue": {
          const patch = input.variables.input as {
            addedLabelIds?: string[];
            removedLabelIds?: string[];
            title?: string;
            description?: string;
            priority?: number;
          };
          if (!controls.partialError) {
            issue.labelIds = [
              ...new Set([
                ...issue.labelIds.filter(
                  (id) => !patch.removedLabelIds?.includes(id),
                ),
                ...(patch.addedLabelIds ?? []),
              ]),
            ];
            if (patch.title !== undefined) issue.title = patch.title;
            if (patch.description !== undefined)
              issue.description = patch.description;
            if (patch.priority !== undefined) issue.priority = patch.priority;
            issue.updatedAt = new Date(
              Date.parse(issue.updatedAt) + 1,
            ).toISOString();
          }
          data = { issueUpdate: { success: true, issue: { id: issue.id } } };
          if (controls.failAfterUpdate) controls.failIssueRead = true;
          break;
        }
        default: {
          const field = operation.replace(/^issue_/, "");
          if (
            operation.startsWith("issue_") &&
            [
              "children",
              "comments",
              "attachments",
              "relations",
              "inverseRelations",
            ].includes(field)
          )
            data = {
              issue: {
                [field]: connection(
                  controls.relations &&
                    ["relations", "inverseRelations"].includes(field)
                    ? [
                        {
                          id: field,
                          type: "blocks",
                          issue: {
                            id: field === "relations" ? "issue" : "blocker",
                          },
                          relatedIssue: {
                            id: field === "relations" ? "blocked" : "issue",
                          },
                        },
                      ]
                    : [],
                ),
              },
            };
          else throw new Error(`Unexpected SDK operation: ${operation}`);
        }
      }
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          data,
          ...(controls.partialError &&
          (operation === "updateIssue" || operation.startsWith("ArcoLinear"))
            ? {
                errors: [
                  {
                    message: "Source rejected the change",
                    extensions: { code: "FORBIDDEN" },
                  },
                ],
              }
            : {}),
        }),
      );
    } catch (error) {
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          errors: [
            {
              message:
                error instanceof Error ? error.message : "Test server failed",
            },
          ],
        }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server unavailable");
  const service = createLinearService({
    auth,
    client: (accessToken) =>
      new LinearClient({
        accessToken,
        apiUrl: `http://127.0.0.1:${address.port}/graphql`,
      }),
    fetch: async () =>
      new Response(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=",
          "base64",
        ),
        { headers: { "Content-Type": "image/png" } },
      ),
  });
  cleanups.push(async () => {
    auth.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  });
  return { service, calls, issue, controls };
}

describe("Linear adapter through the official SDK HTTP transport", () => {
  it("reads one comment page at a time and keeps a reply's unloaded parent identity", async () => {
    const { service, calls, controls } = await source();
    controls.commentCount = 65;
    const issue = (await service.call("linear_get_issue", ref)) as LinearIssue;
    expect(issue.comments).toHaveLength(30);
    expect(issue.commentsHasMore).toBe(true);
    expect(issue.commentsCursor).toBe("comment-29");
    expect(issue.comments[0].parentId).toBe("unloaded-parent");
    expect(
      calls.filter((call) => call.operation === "issue_comments"),
    ).toHaveLength(1);
    const next = (await service.call("linear_comments", {
      ...ref,
      cursor: issue.commentsCursor,
    })) as LinearCommentPage;
    expect(next.comments).toHaveLength(30);
    expect(next.comments[0].id).toBe("comment-30");
    expect(next.cursor).toBe("comment-59");
    expect(
      calls
        .filter((call) => call.operation === "issue_comments")
        .map((call) => call.variables),
    ).toMatchObject([
      { first: 30, orderBy: "createdAt" },
      { first: 30, after: "comment-29", orderBy: "createdAt" },
    ]);
    expect(calls.some((call) => call.operation === "comment")).toBe(false);
  });
  it("reads images through a narrow authorized source lookup and rejects a foreign comment", async () => {
    const { service, calls, issue, controls } = await source();
    const url = "https://uploads.linear.app/workspace/image.png";
    issue.description = `![Source image](${url})`;
    await expect(
      service.call("linear_read_image", { ...ref, url }),
    ).resolves.toMatchObject({ mimeType: "image/png" });
    await expect(
      service.call("linear_read_image", {
        ...ref,
        url,
        commentId: "comment-100",
      }),
    ).resolves.toMatchObject({ mimeType: "image/png" });
    expect(
      calls.some((call) =>
        ["issue_comments", "team_projects", "issue_children"].includes(
          call.operation,
        ),
      ),
    ).toBe(false);
    controls.commentIssueId = "foreign-issue";
    await expect(
      service.call("linear_read_image", {
        ...ref,
        url,
        commentId: "foreign-comment",
      }),
    ).rejects.toThrow("does not belong");
    await expect(
      service.call("linear_read_image", {
        ...ref,
        workspaceId: "foreign-workspace",
        url,
      }),
    ).rejects.toThrow("workspace");
    await expect(
      service.call("linear_read_image", {
        ...ref,
        teamId: "foreign-team",
        url,
      }),
    ).rejects.toThrow("team");
  });
  it("resolves a native URL to the source UUIDs across teams without search or mutation", async () => {
    const { service, calls, issue } = await source();
    issue.team.id = "other-team";
    expect(
      await service.call("linear_resolve_issue", {
        connectionId: scope.connectionId,
        url: "https://linear.app/fixture/issue/TST-1/source-title#comment-1",
      }),
    ).toEqual({ ...scope, teamId: "other-team", issueId: "issue" });
    expect(
      calls
        .filter((call) => call.operation === "issue")
        .map((call) => call.variables.id),
    ).toEqual(["TST-1"]);
    expect(
      calls.every((call) =>
        ["organization", "issue", "team"].includes(call.operation),
      ),
    ).toBe(true);
  });
  it("rejects foreign origins before source reads, foreign workspaces before issue lookup, and mismatched canonical issues", async () => {
    const { service, calls, issue } = await source();
    await expect(
      service.call("linear_resolve_issue", {
        connectionId: scope.connectionId,
        url: "https://linear.app.evil.test/fixture/issue/TST-1",
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
    await expect(
      service.call("linear_resolve_issue", {
        connectionId: scope.connectionId,
        url: "https://linear.app/other/issue/TST-1",
      }),
    ).rejects.toThrow("different Linear workspace");
    expect(calls.every((call) => call.operation === "organization")).toBe(true);
    issue.url = "https://linear.app/fixture/issue/TST-2";
    await expect(
      service.call("linear_resolve_issue", {
        connectionId: scope.connectionId,
        url: "https://linear.app/fixture/issue/TST-1",
      }),
    ).rejects.toThrow("different issue");
  });
  it("sends incremental labels, preserves source fields, and refetches the actual detail", async () => {
    const { service, calls } = await source();
    const result = (await service.call("linear_change_labels", {
      ...ref,
      requestId: randomUUID(),
      add: ["added"],
    })) as LinearIssue;
    expect(result.labels.map((label) => label.id)).toEqual([
      "existing",
      "added",
    ]);
    expect(result.body).toBe("Source description");
    expect(result.state.type).toBe("started");
    expect(
      calls
        .filter((call) => call.operation === "updateIssue")
        .map((call) => call.variables.input),
    ).toEqual([{ addedLabelIds: ["added"], removedLabelIds: [] }]);
    expect(calls.every((call) => call.bearer)).toBe(true);
    expect(calls.some((call) => call.operation === "issue_comments")).toBe(
      true,
    );
  });
  it("keeps source search filters and cursors and blocks duplicate merges before mutation", async () => {
    const { service, calls, issue } = await source();
    const page = (await service.call("linear_list_issues", {
      ...scope,
      query: "source text",
      stateId: "state",
      cursor: "previous-page",
    })) as LinearPage;
    expect(page.cursor).toBe("page-2");
    expect(page.hasMore).toBe(true);
    expect(page.issues[0].identifier).toBe("TST-1");
    expect(
      calls.find((call) => call.operation === "ArcoLinearIssueSearch")
        ?.variables,
    ).toMatchObject({
      term: "source text",
      first: 100,
      after: "previous-page",
      filter: { team: { id: { eq: "team" } }, state: { id: { eq: "state" } } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("includeComments: true");
    expect(calls[0].query).not.toMatch(/description|reactions|sharedAccess/);
    expect(page.issues[0]).not.toHaveProperty("body");
    await service.call("linear_list_issues", { ...scope });
    expect(calls).toHaveLength(2);
    expect(calls.some((call) => call.operation === "ArcoLinearIssueList")).toBe(
      true,
    );
    expect(calls.some((call) => call.operation === "issueSearch")).toBe(false);
    await expect(
      service.call("linear_update_issue", {
        ...ref,
        requestId: randomUUID(),
        expectedUpdatedAt: issue.updatedAt,
        patch: { stateId: "duplicate" },
      }),
    ).rejects.toThrow("Merge duplicate");
    expect(calls.some((call) => call.operation === "updateIssue")).toBe(false);
  });
  it("rejects partial list data through the SDK without leaking the source response or falling back", async () => {
    const { service, controls, calls } = await source();
    controls.partialError = true;
    await expect(
      service.call("linear_list_issues", { ...scope, query: "private search" }),
    ).rejects.toThrow(
      /^Unable to load Linear issues\. Check access and refresh\.$/,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].operation).toBe("ArcoLinearIssueSearch");
  });
  it("shares checked context and metadata within one call and reads back a labeled bulk member once", async () => {
    const { service, calls } = await source();
    const result = (await service.call("linear_bulk", {
      ...scope,
      requestId: randomUUID(),
      issueIds: ["issue"],
      patch: { priority: 1 },
      addLabels: ["added"],
    })) as { results: { success: boolean; issue: LinearIssue }[] };
    expect(result.results[0]).toMatchObject({
      success: true,
      issue: { priority: 1 },
    });
    expect(result.results[0].issue.labels.map((label) => label.id)).toEqual([
      "existing",
      "added",
    ]);
    for (const operation of ["team", "issue_comments", "issue_children"])
      expect(
        calls.filter((call) => call.operation === operation),
        operation,
      ).toHaveLength(1);
    expect(
      calls.some((call) =>
        [
          "team_projects",
          "team_states",
          "team_cycles",
          "team_members",
        ].includes(call.operation),
      ),
    ).toBe(false);
    expect(
      calls.filter((call) => call.operation === "updateIssue"),
    ).toHaveLength(2);
    const firstCallTeamReads = calls.filter(
      (call) => call.operation === "team",
    ).length;
    await service.call("linear_get_issue", ref);
    expect(calls.filter((call) => call.operation === "team")).toHaveLength(
      firstCallTeamReads + 1,
    );
  });
  it("rejects GraphQL partial errors and reports an intra-issue bulk partial save", async () => {
    const { service, issue, controls } = await source();
    controls.partialError = true;
    await expect(
      service.call("linear_update_issue", {
        ...ref,
        requestId: randomUUID(),
        expectedUpdatedAt: issue.updatedAt,
        patch: { title: "Rejected title" },
      }),
    ).rejects.toMatchObject({
      code: "uncertain",
      message: expect.not.stringContaining("Source rejected"),
    });
    expect(issue.title).toBe("Source title");
    controls.partialError = false;
    const result = (await service.call("linear_bulk", {
      ...scope,
      requestId: randomUUID(),
      issueIds: ["issue"],
      patch: { priority: 1 },
      addLabels: ["missing-label"],
    })) as {
      results: { success: boolean; error: string; issue: LinearIssue }[];
    };
    expect(result.results[0].success).toBe(false);
    expect(result.results[0]).toMatchObject({ saved: true, retryable: false });
    expect(result.results[0].error).toContain("Properties were saved");
    expect(result.results[0].issue.priority).toBe(1);
    expect(result.results[0].issue.labels.map((label) => label.id)).toEqual([
      "existing",
    ]);
  });
  it("reads an issue and edits its title without unrelated field catalogs", async () => {
    const { service, calls, issue, controls } = await source();
    controls.failProjects = true;
    const detail = (await service.call("linear_get_issue", ref)) as LinearIssue;
    expect(detail.title).toBe("Source title");
    const detailRequests = calls.length;
    const updated = (await service.call("linear_update_issue", {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "A narrow title change" },
    })) as LinearIssue;
    expect(updated.title).toBe("A narrow title change");
    expect(
      calls.some((call) =>
        /^(?:team_(?:projects|states|members|cycles|labels)|organization_labels|project_projectMilestones)$/.test(
          call.operation,
        ),
      ),
    ).toBe(false);
    expect(detailRequests).toBeLessThan(15);
    expect(calls.length - detailRequests).toBeLessThan(17);
  });
  it("retries the same request after a read fails before any mutation", async () => {
    const { service, calls, issue, controls } = await source();
    const input = {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "Recovered title" },
    };
    controls.failIssueRead = true;
    await expect(
      service.call("linear_update_issue", input),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(calls.some((call) => call.operation === "updateIssue")).toBe(false);
    controls.failIssueRead = false;
    await expect(
      service.call("linear_update_issue", input),
    ).resolves.toMatchObject({ title: "Recovered title" });
    expect(
      calls.filter((call) => call.operation === "updateIssue"),
    ).toHaveLength(1);
  });
  it("keeps an acknowledged bulk save successful when only readback fails", async () => {
    const { service, calls, controls } = await source();
    controls.failAfterUpdate = true;
    const input = {
      ...scope,
      requestId: randomUUID(),
      issueIds: ["issue"],
      patch: { priority: 1 },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = (await service.call("linear_bulk", input)) as {
        results: object[];
      };
      expect(result.results).toEqual([
        expect.objectContaining({
          issueId: "issue",
          success: true,
          saved: true,
          retryable: false,
          refreshError: expect.any(String),
        }),
      ]);
    }
    expect(
      calls.filter((call) => call.operation === "updateIssue"),
    ).toHaveLength(1);
  });
  it("allows the same request after a mutation was definitively rejected", async () => {
    const { service, controls, issue, calls } = await source();
    const input = {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "Allowed after access recovery" },
    };
    controls.rejectUpdate = true;
    await expect(
      service.call("linear_update_issue", input),
    ).rejects.toMatchObject({ code: "forbidden" });
    controls.rejectUpdate = false;
    await expect(
      service.call("linear_update_issue", input),
    ).resolves.toMatchObject({ title: "Allowed after access recovery" });
    expect(
      calls.filter((call) => call.operation === "updateIssue"),
    ).toHaveLength(2);
  });
  it("distinguishes retryable bulk preflight failures from ambiguous mutations", async () => {
    const { service, controls } = await source();
    const input = { ...scope, issueIds: ["issue"], patch: { priority: 1 } };
    controls.failIssueRead = true;
    const beforeWrite = (await service.call("linear_bulk", {
      ...input,
      requestId: randomUUID(),
    })) as { results: object[] };
    expect(beforeWrite.results[0]).toMatchObject({
      success: false,
      saved: false,
      retryable: true,
    });
    controls.failIssueRead = false;
    controls.partialError = true;
    const uncertain = (await service.call("linear_bulk", {
      ...input,
      requestId: randomUUID(),
    })) as { results: object[] };
    expect(uncertain.results[0]).toMatchObject({
      success: false,
      saved: false,
      retryable: false,
    });
  });
  it("returns a saved receipt for an update whose readback fails", async () => {
    const { service, controls, issue, calls } = await source();
    controls.failAfterUpdate = true;
    const input = {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "Acknowledged update" },
    };
    await expect(
      service.call("linear_update_issue", input),
    ).resolves.toMatchObject({
      kind: "linear_saved_receipt",
      operation: "update_issue",
      saved: true,
    });
    await expect(
      service.call("linear_update_issue", input),
    ).resolves.toMatchObject({ kind: "linear_saved_receipt", saved: true });
    expect(
      calls.filter((call) => call.operation === "updateIssue"),
    ).toHaveLength(1);
  });
  it.each([undefined, "yes", 1])(
    "does not replay a mutation with an invalid success acknowledgement %s",
    async (success) => {
      const { service, controls, calls } = await source();
      controls.mutationSuccess = success;
      const input = {
        ...ref,
        requestId: randomUUID(),
        action: "create",
        body: "Post once",
      };
      await expect(service.call("linear_comment", input)).rejects.toMatchObject(
        { code: "uncertain" },
      );
      controls.mutationSuccess = true;
      await expect(service.call("linear_comment", input)).rejects.toMatchObject(
        { code: "uncertain" },
      );
      expect(
        calls.filter((call) => call.operation === "createComment"),
      ).toHaveLength(1);
    },
  );
  it("retries after the SDK explicitly reports mutation success false", async () => {
    const { service, controls, calls } = await source();
    controls.mutationSuccess = false;
    const input = {
      ...ref,
      requestId: randomUUID(),
      action: "create",
      body: "Post after rejection",
    };
    await expect(service.call("linear_comment", input)).rejects.toMatchObject({
      code: "invalid-input",
    });
    controls.mutationSuccess = true;
    await expect(service.call("linear_comment", input)).resolves.toMatchObject({
      source: "linear",
      issueId: "issue",
    });
    expect(
      calls.filter((call) => call.operation === "createComment"),
    ).toHaveLength(2);
  });
  it("preserves a completed preparatory step when a later upload step fails", async () => {
    const { service, calls } = await source();
    const input = {
      ...ref,
      requestId: randomUUID(),
      filename: "sample.bin",
      contentType: "application/octet-stream",
      base64: "AAAA",
    };
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(service.call("linear_upload", input)).rejects.toMatchObject({
        code: "uncertain",
        message: expect.stringContaining("An earlier step completed in Linear"),
      });
    expect(
      calls.filter((call) => call.operation === "fileUpload"),
    ).toHaveLength(1);
    expect(calls.some((call) => call.operation === "updateIssue")).toBe(false);
  });
  it("preserves incoming and outgoing dependency meaning with original relation IDs", async () => {
    const { service, controls } = await source();
    controls.relations = true;
    const issue = (await service.call("linear_get_issue", ref)) as LinearIssue;
    expect(issue.relations).toMatchObject([
      {
        id: "relations",
        type: "blocks",
        issueId: "issue",
        relatedIssueId: "blocked",
        identifier: "TST-2",
      },
      {
        id: "inverseRelations",
        type: "blocked-by",
        issueId: "blocker",
        relatedIssueId: "issue",
        identifier: "TST-3",
      },
    ]);
  });
  it("preserves an untouched template description and allows an explicit empty override", async () => {
    const { service, calls } = await source();
    const inherited = (await service.call("linear_create_issue", {
      ...scope,
      requestId: randomUUID(),
      title: "Chosen title",
      templateId: "template",
    })) as LinearIssue;
    expect(inherited.body).toBe("Default template description");
    expect(
      calls.find((call) => call.operation === "createIssue")?.variables.input,
    ).toEqual({
      teamId: "team",
      title: "Chosen title",
      templateId: "template",
    });
    const cleared = (await service.call("linear_create_issue", {
      ...scope,
      requestId: randomUUID(),
      title: "Chosen title",
      templateId: "template",
      body: "",
    })) as LinearIssue;
    expect(cleared.body).toBe("");
  });
  it("keeps acknowledged creation IDs when readback fails and never repeats the same write", async () => {
    const issueSource = await source();
    issueSource.controls.failAfterCreate = "issue";
    const create = {
      ...scope,
      requestId: randomUUID(),
      title: "Acknowledged issue",
    };
    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        await issueSource.service.call("linear_create_issue", create),
      ).toMatchObject({
        kind: "linear_saved_receipt",
        saved: true,
        operation: "create_issue",
        issueId: "issue",
        message: expect.stringContaining("Do not create it again."),
      });
    expect(
      issueSource.calls.filter((call) => call.operation === "createIssue"),
    ).toHaveLength(1);
    const commentSource = await source();
    commentSource.controls.failAfterCreate = "comment";
    const comment = {
      ...ref,
      requestId: randomUUID(),
      action: "create",
      body: "Acknowledged comment",
    };
    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        await commentSource.service.call("linear_comment", comment),
      ).toMatchObject({
        kind: "linear_saved_receipt",
        saved: true,
        operation: "create_comment",
        issueId: "issue",
        commentId: "created-comment",
        message: expect.stringContaining("Do not post it again."),
      });
    expect(
      commentSource.calls.filter((call) => call.operation === "createComment"),
    ).toHaveLength(1);
  });
});
