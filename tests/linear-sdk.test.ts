import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { text } from "node:stream/consumers";
import { LinearClient } from "@linear/sdk";
import {
  createLinearAuth,
  type CredentialStore,
  type LinearCredential,
} from "../src/server/linear/auth";
import { createLinearService } from "../src/server/linear/service";
import type {
  LinearCommentPage,
  LinearIssue,
  LinearMetadata,
  LinearPage,
  LinearSavedReceipt,
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
  const credentials = new Map<string, LinearCredential>(
    [scope.connectionId, "other-test"].map((connectionId) => [
      connectionId,
      {
        clientId: "fake-public-client",
        accessToken:
          connectionId === "other-test"
            ? "fake-sdk-token-other"
            : "fake-sdk-token",
        refreshToken: "fake-refresh",
        expiresAt: Date.now() + 86_400_000,
        scopes: ["read", "write"],
        authorizationId: randomUUID(),
      },
    ]),
  );
  const storeControls = { failRemove: false };
  const store: CredentialStore = {
    async read(connectionId) {
      return structuredClone(credentials.get(connectionId) ?? null);
    },
    async write(connectionId, value) {
      credentials.set(connectionId, structuredClone(value));
    },
    async remove(connectionId) {
      if (storeControls.failRemove)
        throw new Error("Fictional credential removal failed");
      credentials.delete(connectionId);
    },
  };
  const auth = createLinearAuth({
    directory,
    store,
    fetch: async () =>
      Response.json({
        access_token: "fake-sdk-token-rotated",
        refresh_token: "fake-refresh-rotated",
        expires_in: 86400,
        scope: "read write",
      }),
  });
  const hooks: { beforeOperation?: (operation: string) => Promise<void> } = {};
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
    commentAuthorIds: [] as (string | null)[],
    userName: "Test user",
    userError: "" as "" | "forbidden" | "partial",
    userErrorOnce: false,
    teamParents: {} as Record<string, string>,
    commentIssueId: "issue",
  };
  const sourceComment = (id: string) => {
    const authorId =
      controls.commentAuthorIds[Number(id.replace("comment-", ""))];
    return {
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
      ...(authorId ? { user: { id: authorId } } : {}),
    };
  };
  const server: Server = createServer(async (request, response) => {
    try {
      const input = JSON.parse(await text(request)) as {
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
      await hooks.beforeOperation?.(operation);
      if (
        (operation === "updateIssue" && controls.rejectUpdate) ||
        (operation === "user" &&
          input.variables.id === "comment-author" &&
          controls.userError === "forbidden")
      ) {
        if (operation === "user" && controls.userErrorOnce)
          controls.userError = "";
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
      const teamId =
        typeof input.variables.id === "string" ? input.variables.id : "team";
      const team = {
        id: teamId,
        name: "Test team",
        key: "TST",
        inheritIssueEstimation: false,
        inheritWorkflowStatuses: Boolean(controls.teamParents[teamId]),
        parent: controls.teamParents[teamId]
          ? { id: controls.teamParents[teamId] }
          : null,
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
          data = {
            user: {
              id: input.variables.id,
              name:
                request.headers.authorization === "Bearer fake-sdk-token-other"
                  ? `${controls.userName} (other connection)`
                  : controls.userName,
            },
          };
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
          ) {
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
            break;
          }
          throw new Error(`Unexpected SDK operation: ${operation}`);
        }
      }
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          data,
          ...((controls.partialError &&
            (operation === "updateIssue" ||
              operation.startsWith("ArcoLinear"))) ||
          (operation === "user" &&
            input.variables.id === "comment-author" &&
            controls.userError === "partial")
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
  return {
    service,
    calls,
    issue,
    controls,
    auth,
    store,
    storeControls,
    hooks,
  };
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

  it("reads each distinct comment author once within a comment page", async () => {
    const { service, calls, controls } = await source();
    controls.commentCount = 30;
    controls.commentAuthorIds = Array.from(
      { length: 30 },
      (_, index) => `author-${index % 3}`,
    );
    const page = (await service.call(
      "linear_comments",
      ref,
    )) as LinearCommentPage;
    expect(page.comments.map((comment) => comment.authorId)).toEqual(
      controls.commentAuthorIds,
    );
    expect(
      page.comments.every((comment) => comment.author === "Test user"),
    ).toBe(true);
    expect(
      calls
        .filter((call) => call.operation === "user")
        .map((call) => call.variables.id)
        .sort(),
    ).toEqual(["author-0", "author-1", "author-2"]);
  });

  it("keeps the deleted author fallback without an author query", async () => {
    const { service, calls, controls } = await source();
    controls.commentCount = 3;
    controls.commentAuthorIds = [null, null, null];
    const page = (await service.call(
      "linear_comments",
      ref,
    )) as LinearCommentPage;
    expect(page.comments).toHaveLength(3);
    expect(
      page.comments.map((comment) => ({
        author: comment.author,
        authorId: comment.authorId,
      })),
    ).toEqual(Array(3).fill({ author: "Deleted user", authorId: "" }));
    expect(calls.some((call) => call.operation === "user")).toBe(false);
  });

  it.each(["forbidden", "partial"] as const)(
    "rejects a %s author read without substituting a deleted user",
    async (failure) => {
      const { service, calls, controls } = await source();
      controls.commentCount = 2;
      controls.commentAuthorIds = ["comment-author", "comment-author"];
      controls.userError = failure;
      await expect(service.call("linear_comments", ref)).rejects.toMatchObject({
        code: failure === "forbidden" ? "forbidden" : "unavailable",
        message: expect.not.stringContaining("Source rejected"),
      });
      controls.userError = "";
      const page = (await service.call(
        "linear_comments",
        ref,
      )) as LinearCommentPage;
      expect(page.comments.map((comment) => comment.author)).toEqual([
        "Test user",
        "Test user",
      ]);
      expect(calls.filter((call) => call.operation === "user")).toHaveLength(2);
    },
  );

  it("reads comment authors afresh for the next operation and connection", async () => {
    const { service, calls, controls } = await source();
    controls.commentCount = 2;
    controls.commentAuthorIds = ["comment-author", "comment-author"];
    controls.userName = "First name";
    const first = (await service.call(
      "linear_comments",
      ref,
    )) as LinearCommentPage;
    expect(first.comments[0].author).toBe("First name");
    controls.userName = "Changed name";
    const next = (await service.call(
      "linear_comments",
      ref,
    )) as LinearCommentPage;
    expect(next.comments[0].author).toBe("Changed name");
    const other = (await service.call("linear_comments", {
      ...ref,
      connectionId: "other-test",
    })) as LinearCommentPage;
    expect(other.comments[0].author).toBe("Changed name (other connection)");
    expect(calls.filter((call) => call.operation === "user")).toHaveLength(3);
  });

  it.each([false, true])(
    "shares successful author reads and recovers a failed author read between bulk members (failure: %s)",
    async (failFirst) => {
      const { service, calls, controls } = await source();
      controls.commentCount = 2;
      controls.commentAuthorIds = ["comment-author", "comment-author"];
      if (failFirst) {
        controls.userError = "forbidden";
        controls.userErrorOnce = true;
      }
      const result = (await service.call("linear_bulk", {
        ...scope,
        requestId: randomUUID(),
        issueIds: ["issue", "other"],
        patch: { priority: 1 },
      })) as {
        results: {
          success: boolean;
          issue?: LinearIssue;
          refreshError?: string;
        }[];
      };
      expect(result.results.every((item) => item.success)).toBe(true);
      expect(Boolean(result.results[0].refreshError)).toBe(failFirst);
      expect(result.results[1].issue?.comments[0].author).toBe("Test user");
      expect(
        calls.filter(
          (call) =>
            call.operation === "user" && call.variables.id === "comment-author",
        ),
      ).toHaveLength(failFirst ? 2 : 1);
    },
  );

  it.each([false, true])(
    "reads each parent once while retaining inherited states and cycle detection (cycle: %s)",
    async (cycle) => {
      const { service, calls, controls } = await source();
      controls.teamParents = {
        team: "parent",
        parent: cycle ? "team" : "root",
      };
      const metadata = (await service.call(
        "linear_metadata",
        scope,
      )) as LinearMetadata;
      expect(metadata.states).not.toHaveLength(0);
      expect(
        calls
          .filter((call) => call.operation === "team")
          .map((call) => call.variables.id),
      ).toEqual(["team", "parent", cycle ? "team" : "root"]);
      expect(
        calls.find((call) => call.operation === "team_states")?.variables.id,
      ).toBe(cycle ? "parent" : "root");
    },
  );
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
  it.each([
    { name: "labels only", patch: false, labels: true, reads: 2 },
    { name: "properties only", patch: true, labels: false, reads: 2 },
    { name: "properties and labels", patch: true, labels: true, reads: 3 },
  ])(
    "shares checked context and preserves bulk read order for $name",
    async ({ patch, labels, reads }) => {
      const { service, calls } = await source();
      const issueIds = ["issue", "other"];
      const add = ["added", "added"];
      const remove = ["existing", "existing"];
      const result = (await service.call("linear_bulk", {
        ...scope,
        requestId: randomUUID(),
        issueIds,
        ...(patch ? { patch: { priority: 1 } } : {}),
        ...(labels ? { addLabels: add, removeLabels: remove } : {}),
      })) as { results: { success: boolean; issue: LinearIssue }[] };
      expect(result.results).toHaveLength(issueIds.length);
      for (const member of result.results) {
        expect(member).toMatchObject({
          success: true,
          issue: { priority: patch ? 1 : 2 },
        });
        expect(member.issue.labels.map((label) => label.id)).toEqual(
          labels ? ["added"] : ["existing"],
        );
      }
      expect(calls.filter((call) => call.operation === "team")).toHaveLength(1);
      for (const operation of ["issue_comments", "issue_children"])
        expect(
          calls.filter((call) => call.operation === operation),
        ).toHaveLength(issueIds.length);
      for (const issueId of issueIds) {
        const memberCalls = calls.filter(
          (call) =>
            call.variables.id === issueId &&
            ["issue", "updateIssue"].includes(call.operation),
        );
        expect(
          memberCalls.filter((call) => call.operation === "issue"),
        ).toHaveLength(reads);
        expect(memberCalls.map((call) => call.operation)).toEqual([
          "issue",
          "updateIssue",
          ...(patch && labels ? ["issue", "updateIssue"] : []),
          "issue",
        ]);
      }
      expect(
        calls
          .filter((call) => call.operation === "updateIssue")
          .map((call) => call.variables.input),
      ).toEqual(
        issueIds.flatMap(() => [
          ...(patch ? [{ priority: 1 }] : []),
          ...(labels ? [{ addedLabelIds: add, removedLabelIds: remove }] : []),
        ]),
      );
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
      const firstCallTeamReads = calls.filter(
        (call) => call.operation === "team",
      ).length;
      await service.call("linear_get_issue", ref);
      expect(calls.filter((call) => call.operation === "team")).toHaveLength(
        firstCallTeamReads + 1,
      );
    },
  );
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
    const issueId = randomUUID();
    issue.id = issueId;
    controls.failAfterUpdate = true;
    const input = {
      ...ref,
      issueId,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "Acknowledged update" },
    };
    const receipt = (await service.call(
      "linear_update_issue",
      input,
    )) as LinearSavedReceipt;
    expect(receipt).toMatchObject({
      kind: "linear_saved_receipt",
      operation: "update_issue",
      saved: true,
      issueId,
    });
    expect(receipt.message).not.toContain(issueId);
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
  it("does not expose an old write receipt after disconnect or replacement of the same alias", async () => {
    const { service, auth, store, calls, issue } = await source();
    const input = {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "Account A private receipt" },
    };
    const first = await service.call("linear_update_issue", input);
    expect(first).toMatchObject({ title: "Account A private receipt" });
    const original = await store.read(scope.connectionId);
    if (!original) throw new Error("Fictional credential missing");
    expect(JSON.stringify(first)).not.toContain(original.authorizationId);
    expect(JSON.stringify(first)).not.toContain(original.accessToken);
    await auth.disconnect(scope.connectionId);
    await expect(
      service.call("linear_update_issue", input),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(auth|conflict)$/),
    });
    await store.write(scope.connectionId, {
      ...original,
      authorizationId: randomUUID(),
      accessToken: "fake-sdk-token-other",
    });
    await expect(
      service.call("linear_update_issue", input),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(auth|conflict)$/),
    });
    expect(
      calls.filter((call) => call.operation === "updateIssue"),
    ).toHaveLength(1);
    await expect(
      service.call("linear_update_issue", {
        ...input,
        requestId: randomUUID(),
        expectedUpdatedAt: issue.updatedAt,
        patch: { title: "Explicit new-session update" },
      }),
    ).resolves.toMatchObject({ title: "Explicit new-session update" });
  });
  it("keeps identical writes deduplicated across routine token refresh", async () => {
    const { service, auth, store, calls, issue } = await source();
    const input = {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "One confirmed update" },
    };
    const first = await service.call("linear_update_issue", input);
    const before = await store.read(scope.connectionId);
    await auth.refresh(scope.connectionId);
    expect((await store.read(scope.connectionId))?.authorizationId).toBe(
      before?.authorizationId,
    );
    expect((await store.read(scope.connectionId))?.accessToken).not.toBe(
      before?.accessToken,
    );
    await expect(service.call("linear_update_issue", input)).resolves.toEqual(
      first,
    );
    expect(
      calls.filter((call) => call.operation === "updateIssue"),
    ).toHaveLength(1);
  });
  it("keeps a legitimate write receipt when disconnect fails to remove the credential", async () => {
    const { service, auth, storeControls, calls, issue } = await source();
    const input = {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "Still the same grant" },
    };
    const first = await service.call("linear_update_issue", input);
    storeControls.failRemove = true;
    await expect(auth.disconnect(scope.connectionId)).rejects.toThrow(
      "removal failed",
    );
    await expect(service.call("linear_update_issue", input)).resolves.toEqual(
      first,
    );
    expect(
      calls.filter((call) => call.operation === "updateIssue"),
    ).toHaveLength(1);
  });
  it("does not resume a paused preflight into a mutation after reconnect", async () => {
    const { service, auth, store, hooks, calls, issue } = await source();
    const original = await store.read(scope.connectionId);
    if (!original) throw new Error("Fictional credential missing");
    let notify = () => {};
    let resume = () => {};
    const paused = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    hooks.beforeOperation = async (operation) => {
      if (operation === "issue") {
        notify();
        await gate;
      }
    };
    const pending = service.call("linear_update_issue", {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "Should not be sent" },
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: expect.stringMatching(/^(auth|conflict)$/),
    });
    try {
      await paused;
      await auth.disconnect(scope.connectionId);
      await store.write(scope.connectionId, {
        ...original,
        authorizationId: randomUUID(),
        accessToken: "fake-sdk-token-other",
      });
    } finally {
      resume();
    }
    await rejected;
    expect(calls.filter((call) => call.operation === "updateIssue")).toEqual(
      [],
    );
  });
  it("does not expose a dispatched write's late result after reconnect", async () => {
    const { service, auth, store, hooks, calls, issue } = await source();
    const original = await store.read(scope.connectionId);
    if (!original) throw new Error("Fictional credential missing");
    let notify = () => {};
    let resume = () => {};
    const paused = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    hooks.beforeOperation = async (operation) => {
      if (operation === "updateIssue") {
        notify();
        await gate;
      }
    };
    const input = {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "Late account A receipt" },
    };
    const pending = service.call("linear_update_issue", input);
    const rejected = expect(pending).rejects.toMatchObject({
      code: expect.stringMatching(/^(auth|conflict|uncertain)$/),
    });
    try {
      await paused;
      await auth.disconnect(scope.connectionId);
      await store.write(scope.connectionId, {
        ...original,
        authorizationId: randomUUID(),
        accessToken: "fake-sdk-token-other",
      });
    } finally {
      resume();
    }
    await rejected;
    await expect(
      service.call("linear_update_issue", input),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(auth|conflict|uncertain)$/),
    });
    expect(
      calls.filter((call) => call.operation === "updateIssue"),
    ).toHaveLength(1);
  });
  it("keeps an unconfirmed write blocked after its connection alias is rebound", async () => {
    const { service, auth, store, controls, calls, issue } = await source();
    const original = await store.read(scope.connectionId);
    if (!original) throw new Error("Fictional credential missing");
    controls.partialError = true;
    const input = {
      ...ref,
      requestId: randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { title: "Unconfirmed earlier write" },
    };
    await expect(
      service.call("linear_update_issue", input),
    ).rejects.toMatchObject({ code: "uncertain" });
    await auth.disconnect(scope.connectionId);
    await store.write(scope.connectionId, {
      ...original,
      authorizationId: randomUUID(),
      accessToken: "fake-sdk-token-other",
    });
    controls.partialError = false;
    await expect(
      service.call("linear_update_issue", input),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(auth|conflict|uncertain)$/),
    });
    expect(
      calls.filter((call) => call.operation === "updateIssue"),
    ).toHaveLength(1);
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
    const issueId = randomUUID();
    issueSource.issue.id = issueId;
    issueSource.controls.failAfterCreate = "issue";
    const create = {
      ...scope,
      requestId: randomUUID(),
      title: "Acknowledged issue",
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const receipt = (await issueSource.service.call(
        "linear_create_issue",
        create,
      )) as LinearSavedReceipt;
      expect(receipt).toMatchObject({
        kind: "linear_saved_receipt",
        saved: true,
        operation: "create_issue",
        issueId,
      });
      expect(receipt.message).not.toContain(issueId);
    }
    expect(
      issueSource.calls.filter((call) => call.operation === "createIssue"),
    ).toHaveLength(1);
    const commentSource = await source();
    commentSource.issue.id = issueId;
    commentSource.controls.commentIssueId = issueId;
    commentSource.controls.failAfterCreate = "comment";
    const comment = {
      ...ref,
      issueId,
      requestId: randomUUID(),
      action: "create",
      body: "Acknowledged comment",
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const receipt = (await commentSource.service.call(
        "linear_comment",
        comment,
      )) as LinearSavedReceipt;
      expect(receipt).toMatchObject({
        kind: "linear_saved_receipt",
        saved: true,
        operation: "create_comment",
        issueId,
        commentId: "created-comment",
      });
      expect(receipt.message).not.toContain(issueId);
      expect(receipt.message).not.toContain(receipt.commentId);
    }
    expect(
      commentSource.calls.filter((call) => call.operation === "createComment"),
    ).toHaveLength(1);
  });
});
