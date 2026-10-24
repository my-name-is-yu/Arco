import { describe, expect, it, vi } from "vitest";
import type { LinearClient } from "@linear/sdk";
import { createLinearIssueReader } from "../src/server/linear/issue-list";
import type { LinearAuth } from "../src/server/linear/auth";
import type { Args } from "../src/server/linear/operation";

const scope = {
  connectionId: "connection",
  workspaceId: "workspace",
  teamId: "team",
};
const input: Args<"linear_list_issues"> = {
  ...scope,
  query: "",
  order: "updatedAt",
};
const issue = (number = 1) => ({
  id: `issue-${number}`,
  identifier: `TST-${number}`,
  title: `Issue ${number}`,
  url: `https://linear.app/workspace/issue/TST-${number}/issue-title`,
  updatedAt: "2026-10-24T00:00:00.000Z",
  team: { id: "team" },
  state: { id: "state", name: "Todo", type: "unstarted", color: "#888888" },
});
const response = () => ({
  organization: { id: "workspace", urlKey: "workspace" },
  team: { id: "team", organization: { id: "workspace" } },
  issuePage: {
    nodes: [issue()],
    pageInfo: { hasNextPage: false, endCursor: "last-item" as string | null },
  },
});
function reader(value: unknown = response()) {
  const request = vi.fn().mockResolvedValue(value);
  const accessToken = vi.fn().mockResolvedValue("private-test-token");
  const makeClient = vi.fn(
    () => ({ client: { request } }) as unknown as LinearClient,
  );
  const list = createLinearIssueReader({
    auth: { accessToken } as unknown as LinearAuth,
    makeClient,
  });
  return { list, request, accessToken, makeClient };
}

describe("Linear summary-only issue list", () => {
  it("loads only list fields in one authenticated request without metadata", async () => {
    const { list, request, accessToken, makeClient } = reader();
    const page = await list(input);
    expect(page).toEqual({
      issues: [
        {
          ...scope,
          source: "linear",
          issueId: "issue-1",
          identifier: "TST-1",
          title: "Issue 1",
          url: issue().url,
          updatedAt: issue().updatedAt,
          state: issue().state,
        },
      ],
      hasMore: false,
      cursor: "last-item",
    });
    expect(accessToken).toHaveBeenCalledExactlyOnceWith("connection");
    expect(makeClient).toHaveBeenCalledExactlyOnceWith("private-test-token");
    expect(request).toHaveBeenCalledTimes(1);
    const [query, variables] = request.mock.calls[0];
    expect(query).toContain("issuePage: issues(");
    expect(query).not.toMatch(
      /description|reaction|attachment|creator|assignee|project|cycle|labels|includeArchived/,
    );
    expect(variables).toEqual({
      teamId: "team",
      first: 100,
      filter: { team: { id: { eq: "team" } } },
      orderBy: "updatedAt",
    });
  });

  it("preserves full-text/comment search, every filter, order, and cursor", async () => {
    const { list, request } = reader();
    await list({
      ...input,
      query: "  comment-only phrase  ",
      stateId: "state",
      assigneeId: "member",
      labelId: "label",
      projectId: "project",
      cursor: "previous",
      order: "createdAt",
    });
    const [query, variables] = request.mock.calls[0];
    expect(query).toContain("issuePage: searchIssues(");
    expect(query).toContain("includeComments: true");
    expect(query).not.toContain("includeArchived");
    expect(variables).toEqual({
      teamId: "team",
      term: "  comment-only phrase  ",
      first: 100,
      after: "previous",
      orderBy: "createdAt",
      filter: {
        team: { id: { eq: "team" } },
        state: { id: { eq: "state" } },
        assignee: { id: { eq: "member" } },
        labels: { some: { id: { eq: "label" } } },
        project: { id: { eq: "project" } },
      },
    });
  });

  it("uses native issues for whitespace-only search and checks fresh authorization each page", async () => {
    const { list, accessToken, request } = reader();
    await list({ ...input, query: " \n " });
    accessToken.mockResolvedValueOnce("rotated-token");
    await list({ ...input, cursor: "previous" });
    expect(accessToken).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.every(([query]) => !query.includes("searchIssues")),
    ).toBe(true);
  });

  it("returns 100 rows and a provider cursor without truncating", async () => {
    const value = response();
    value.issuePage.nodes = Array.from({ length: 100 }, (_, index) =>
      issue(index + 1),
    );
    value.issuePage.pageInfo = { hasNextPage: true, endCursor: "next-page" };
    const { list } = reader(value);
    const page = await list(input);
    expect(page.issues).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBe("next-page");
  });

  it("keeps the SDK's normalized UTC timestamp representation", async () => {
    const value = response();
    value.issuePage.nodes[0].updatedAt = "2026-10-24T09:00:00+09:00";
    expect((await reader(value).list(input)).issues[0].updatedAt).toBe(
      "2026-10-24T00:00:00.000Z",
    );
  });

  it("allows an empty terminal page and strips unexpected detail data", async () => {
    const value = response();
    const withDetails = {
      ...value,
      issuePage: {
        ...value.issuePage,
        nodes: [
          { ...issue(), description: "private body", reactions: ["private"] },
        ],
      },
    };
    const populated = await reader(withDetails).list(input);
    expect(JSON.stringify(populated)).not.toMatch(
      /private|description|reactions|body/,
    );
    value.issuePage.nodes = [];
    value.issuePage.pageInfo.endCursor = null;
    expect(await reader(value).list(input)).toEqual({
      issues: [],
      hasMore: false,
      cursor: null,
    });
  });

  it.each([
    [
      "foreign workspace",
      (value: ReturnType<typeof response>) => {
        value.organization.id = "foreign";
      },
    ],
    [
      "foreign selected team",
      (value: ReturnType<typeof response>) => {
        value.team.id = "foreign";
      },
    ],
    [
      "foreign team organization",
      (value: ReturnType<typeof response>) => {
        value.team.organization.id = "foreign";
      },
    ],
    [
      "foreign issue team",
      (value: ReturnType<typeof response>) => {
        value.issuePage.nodes[0].team.id = "foreign";
      },
    ],
    [
      "foreign canonical workspace",
      (value: ReturnType<typeof response>) => {
        value.issuePage.nodes[0].url = "https://linear.app/other/issue/TST-1";
      },
    ],
    [
      "mismatched canonical issue",
      (value: ReturnType<typeof response>) => {
        value.issuePage.nodes[0].url =
          "https://linear.app/workspace/issue/TST-2";
      },
    ],
    [
      "foreign canonical origin",
      (value: ReturnType<typeof response>) => {
        value.issuePage.nodes[0].url =
          "https://linear.app.evil.test/workspace/issue/TST-1";
      },
    ],
    [
      "duplicate issue",
      (value: ReturnType<typeof response>) => {
        value.issuePage.nodes.push(issue());
      },
    ],
  ])("rejects %s instead of dropping a row", async (_name, mutate) => {
    const value = response();
    mutate(value);
    await expect(reader(value).list(input)).rejects.toThrow(
      /workspace|team|identity|scope/,
    );
  });

  it("rejects a mismatched filtered workflow state", async () => {
    await expect(
      reader().list({ ...input, stateId: "other-state" }),
    ).rejects.toThrow("scope");
  });

  it.each([
    null,
    {},
    { ...response(), errors: [{ message: "partial private data" }] },
    { ...response(), team: null },
    {
      ...response(),
      issuePage: {
        nodes: [null],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
    {
      ...response(),
      issuePage: {
        ...response().issuePage,
        nodes: [{ ...issue(), state: null }],
      },
    },
    {
      ...response(),
      issuePage: {
        ...response().issuePage,
        nodes: [{ ...issue(), state: { ...issue().state, name: "" } }],
      },
    },
    {
      ...response(),
      issuePage: {
        ...response().issuePage,
        nodes: [{ ...issue(), updatedAt: "not-a-date" }],
      },
    },
    {
      ...response(),
      issuePage: {
        ...response().issuePage,
        nodes: [{ ...issue(), identifier: "not-an-identifier" }],
      },
    },
    {
      ...response(),
      issuePage: {
        ...response().issuePage,
        nodes: Array.from({ length: 101 }, (_, index) => issue(index + 1)),
      },
    },
  ])(
    "rejects incomplete or malformed source responses without partial results",
    async (value) => {
      await expect(reader(value).list(input)).rejects.toThrow(
        "incomplete issue list",
      );
    },
  );

  it.each([
    { nodes: [issue()], pageInfo: { hasNextPage: true, endCursor: null } },
    {
      nodes: [issue()],
      pageInfo: { hasNextPage: true, endCursor: "previous" },
    },
    { nodes: [], pageInfo: { hasNextPage: true, endCursor: "next" } },
  ])(
    "rejects missing, repeated, or empty forward pagination",
    async (issuePage) => {
      await expect(
        reader({ ...response(), issuePage }).list({
          ...input,
          cursor: "previous",
        }),
      ).rejects.toThrow("pagination did not advance");
    },
  );

  it("does not expose SDK source errors, search terms, or credentials", async () => {
    const { list, request, accessToken } = reader();
    request.mockRejectedValueOnce(
      new Error("Bearer private-test-token search-secret source-content"),
    );
    await expect(list({ ...input, query: "search-secret" })).rejects.toThrow(
      /^Unable to load Linear issues\. Check access and refresh\.$/,
    );
    accessToken.mockRejectedValueOnce(new Error("private-refresh-token"));
    await expect(list(input)).rejects.toThrow(
      /^Unable to load Linear issues\. Check access and refresh\.$/,
    );
  });
});
