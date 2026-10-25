import { createServer } from "node:http";
import { LinearClient } from "@linear/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createIssuesHandlers } from "../src/server/linear/issues";
import { createLinearOperation } from "../src/server/linear/operation";
import type { LinearAuth } from "../src/server/linear/auth";

const scope = {
  connectionId: "test",
  workspaceId: "workspace",
  teamId: "team",
  issueId: "issue",
};
const labels = [
  { id: "single-a", parent: { id: "single" } },
  { id: "single-b", parent: { id: "single" } },
  { id: "multi-a", parent: { id: "multi" } },
  { id: "multi-b", parent: { id: "multi" } },
  { id: "standalone" },
  { id: "single", isGroup: true },
  { id: "multi", isGroup: true },
].map((label) => ({
  name: label.id,
  color: "#888888",
  isGroup: false,
  ...label,
}));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function source(
  current: string[] = [],
  singleGroupType: string | null = "singleSelect",
) {
  const calls: { operation: string; variables: Record<string, unknown> }[] = [];
  const connection = (nodes: unknown[]) => ({
    nodes,
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  const server = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const { query, variables } = JSON.parse(body) as {
        query: string;
        variables: Record<string, unknown>;
      };
      const operation = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
      calls.push({ operation, variables });
      let data: object;
      switch (operation) {
        case "organization":
          data = { organization: { id: "workspace", projectStatuses: [] } };
          break;
        case "team":
          data = { team: { id: "team" } };
          break;
        case "issue":
          data = {
            issue: {
              id: "issue",
              team: { id: "team" },
              labelIds: current,
              reactions: [],
              sharedAccess: {
                isShared: false,
                sharedWithCount: 0,
                viewerHasOnlySharedAccess: false,
                disallowedIssueFields: [],
                sharedWithUsers: [],
              },
            },
          };
          break;
        case "organization_labels":
          data = { organization: { labels: connection(labels) } };
          break;
        case "team_labels":
          data = { team: { labels: connection([]) } };
          break;
        case "issueLabel":
          data = {
            issueLabel: {
              id: variables.id,
              groupType:
                variables.id === "multi" ? "multiSelect" : singleGroupType,
            },
          };
          break;
        case "updateIssue":
          data = { issueUpdate: { success: true, issue: { id: "issue" } } };
          break;
        default:
          throw new Error(`Unexpected SDK operation: ${operation}`);
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data }));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ errors: [{ message: String(error) }] }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server unavailable");
  const operation = createLinearOperation({
    auth: { accessToken: async () => "test-token" } as unknown as LinearAuth,
    client: (accessToken) =>
      new LinearClient({
        accessToken,
        apiUrl: `http://127.0.0.1:${address.port}/graphql`,
      }),
    fetch,
  });
  const { applyLabels } = createIssuesHandlers(operation);
  return {
    calls,
    change: (add: string[], remove: string[] = []) =>
      applyLabels({ ...scope, requestId: "test-change", add, remove }),
    groups: () =>
      calls
        .filter((call) => call.operation === "issueLabel")
        .map((call) => call.variables.id),
    writes: () => calls.filter((call) => call.operation === "updateIssue"),
  };
}

describe("Linear label groups through the official SDK HTTP transport", () => {
  it("reads a shared group once and preserves the exact additions", async () => {
    const service = await source();
    const add = ["multi-a", "multi-b", "multi-a"];
    expect(await service.change(add)).toBe("issue");
    expect(service.groups()).toEqual(["multi"]);
    expect(service.writes()).toEqual([
      {
        operation: "updateIssue",
        variables: {
          id: "issue",
          input: { addedLabelIds: add, removedLabelIds: [] },
        },
      },
    ]);
  });

  it.each([
    { current: [], add: ["single-a", "single-b"] },
    { current: ["single-a"], add: ["single-b"] },
  ])(
    "rejects a single-select conflict before mutation: %j",
    async ({ current, add }) => {
      const service = await source(current);
      await expect(service.change(add)).rejects.toThrow(
        "explicitly choose the label to remove",
      );
      expect(service.groups()).toEqual(["single"]);
      expect(service.writes()).toEqual([]);
    },
  );

  it("allows an explicit replacement without removing unrelated labels", async () => {
    const service = await source(["single-a", "standalone"]);
    await service.change(["single-b"], ["single-a"]);
    expect(service.groups()).toEqual(["single"]);
    expect(service.writes()[0].variables).toEqual({
      id: "issue",
      input: { addedLabelIds: ["single-b"], removedLabelIds: ["single-a"] },
    });
  });

  it("allows repeated additions of one single-select member", async () => {
    const service = await source(["single-a"]);
    await service.change(["single-a", "single-a"]);
    expect(service.groups()).toEqual(["single"]);
    expect(service.writes()).toHaveLength(1);
  });

  it("checks each touched group once and leaves standalone labels outside group validation", async () => {
    const service = await source(["single-a"]);
    await service.change(
      ["multi-a", "single-b", "multi-b", "standalone"],
      ["single-a"],
    );
    expect(service.groups()).toEqual(["multi", "single"]);
    expect(service.writes()).toHaveLength(1);
  });

  it("leaves a preexisting conflicting group alone when no member is added", async () => {
    const service = await source(["single-a", "single-b"]);
    await service.change(["multi-a", "multi-b"]);
    expect(service.groups()).toEqual(["multi"]);
    await service.change([], ["single-a"]);
    expect(service.groups()).toEqual(["multi"]);
    expect(service.writes()).toHaveLength(2);
  });

  it.each([null, "future-group-type"])(
    "keeps an unknown group type %j restrictive",
    async (groupType) => {
      const service = await source([], groupType);
      await expect(service.change(["single-a", "single-b"])).rejects.toThrow(
        "explicitly choose the label to remove",
      );
      expect(service.writes()).toEqual([]);
    },
  );

  it("reads groups again for a later change instead of retaining group state", async () => {
    const service = await source();
    await service.change(["multi-a", "multi-b"]);
    await service.change(["multi-a", "multi-b"]);
    expect(service.groups()).toEqual(["multi", "multi"]);
    expect(service.writes()).toHaveLength(2);
  });

  it.each([
    { add: ["unknown"], remove: [] },
    { add: ["single"], remove: [] },
    { add: ["multi-a"], remove: ["unknown"] },
    { add: ["multi-a"], remove: ["multi-a"] },
  ])(
    "rejects invalid labels before group reads or mutations: %j",
    async ({ add, remove }) => {
      const service = await source();
      await expect(service.change(add, remove)).rejects.toThrow(
        "Choose existing team or workspace labels",
      );
      expect(service.groups()).toEqual([]);
      expect(service.writes()).toEqual([]);
    },
  );
});
