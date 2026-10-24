import { describe, expect, it, vi } from "vitest";
import { listInputSchema, type ListInput } from "../src/shared/contracts.js";
import { createRepositoryIssueReader } from "../src/server/github/issue-list";
import { GitHubError } from "../src/server/github/transport";

const repo = "yu/arco";
const input = (overrides: Partial<ListInput> = {}) =>
  listInputSchema.parse({ repo, ...overrides });
const issue = (overrides: Record<string, unknown> = {}) => ({
  __typename: "Issue",
  id: "I_42",
  number: 42,
  title: "Keep the list light",
  state: "OPEN",
  updatedAt: "2026-10-24T01:00:00Z",
  url: `https://github.com/${repo}/issues/42`,
  author: { login: "yu" },
  repository: { nameWithOwner: repo },
  labels: {
    nodes: [{ id: "LA_1", name: "bug", color: "eeeeee" }],
    pageInfo: { hasNextPage: false },
  },
  assignees: {
    nodes: [{ login: "yu" }],
    pageInfo: { hasNextPage: false },
  },
  ...overrides,
});
const response = (
  nodes: unknown[] = [issue()],
  { count = nodes.length, cursor = null as string | null } = {},
) => ({
  data: {
    search: {
      issueCount: count,
      nodes,
      pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
    },
  },
});
function reader(value: unknown = response()) {
  const query = vi.fn<
    (query: string, variables: Record<string, unknown>) => Promise<unknown>
  >(async () => value);
  const legacyList = vi.fn(async (request: ListInput) => ({
    issues: [],
    hasMore: false,
    page: request.page,
  }));
  return {
    query,
    legacyList,
    service: createRepositoryIssueReader({ query, legacyList }),
  };
}

describe("repository issue list GraphQL reader", () => {
  it("requests only summary fields and retains the displayed data", async () => {
    const { service, query, legacyList } = reader();
    expect(await service.list(input())).toEqual({
      issues: [
        {
          source: "github",
          repo,
          number: 42,
          id: "I_42",
          title: "Keep the list light",
          state: "open",
          updatedAt: "2026-10-24T01:00:00Z",
          url: `https://github.com/${repo}/issues/42`,
          author: "yu",
          labels: [{ id: "LA_1", name: "bug", color: "eeeeee" }],
          assignees: ["yu"],
        },
      ],
      hasMore: false,
      page: 1,
    });
    const [document, variables] = query.mock.calls[0];
    expect(document).toContain("type: ISSUE, first: 100, after: $after");
    expect(document).toContain("labels(first: 100)");
    expect(document).toContain("assignees(first: 100)");
    expect(document).not.toMatch(/\b(body|bodyHTML|comments|reactions)\b/);
    expect(variables).toEqual({
      query: `repo:${repo} is:issue is:open sort:updated-desc`,
      after: null,
    });
    expect(legacyList).not.toHaveBeenCalled();
  });

  it.each(["open", "closed", "all"] as const)(
    "keeps %s state, qualifiers and explicit sort order in the search",
    async (state) => {
      for (const sort of ["updated", "created", "comments"] as const) {
        for (const order of ["asc", "desc"] as const) {
          const { service, query } = reader();
          const qualifier = 'label:"needs review" assignee:yu -author:ghost';
          await service.list(input({ state, query: qualifier, sort, order }));
          expect(query).toHaveBeenCalledWith(expect.any(String), {
            query:
              `repo:${repo} is:issue ${state === "all" ? "" : `is:${state}`} ${qualifier}`.trim() +
              ` sort:${sort}-${order}`,
            after: null,
          });
        }
      }
    },
  );

  it("forwards GitHub's real cursor without re-reading preceding pages", async () => {
    const { service, query } = reader(
      response([issue()], { count: 300, cursor: "github-end-cursor-100" }),
    );
    const first = await service.list(input());
    expect(first).toMatchObject({
      page: 1,
      hasMore: true,
      nextCursor: "github-end-cursor-100",
    });
    query.mockResolvedValueOnce(
      response([issue()], { count: 300, cursor: "github-end-cursor-200" }),
    );
    await service.list(input({ page: 2, cursor: first.nextCursor }));
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), {
      query: `repo:${repo} is:issue is:open sort:updated-desc`,
      after: "github-end-cursor-100",
    });
  });

  it("rejects a repeated cursor rather than loading the same page again", async () => {
    const { service, legacyList } = reader(
      response([issue()], { count: 500, cursor: "repeated-cursor" }),
    );
    await expect(
      service.list(input({ page: 2, cursor: "repeated-cursor" })),
    ).rejects.toThrow("invalid issue search page");
    expect(legacyList).not.toHaveBeenCalled();
  });

  it.each([
    { query: "sort:created-asc", sort: "updated" as const },
    { query: "label:bug OR label:feature" },
    { query: "label:bug AND author:yu" },
    { query: "NOT label:bug" },
    { query: "(label:bug label:feature)" },
    { page: 2 },
    { page: 11, cursor: "past-limit" },
  ])("keeps legacy REST behavior for %j", async (overrides) => {
    const { service, query, legacyList } = reader();
    const request = input(overrides);
    expect(await service.list(request)).toEqual({
      issues: [],
      hasMore: false,
      page: request.page,
    });
    expect(legacyList).toHaveBeenCalledExactlyOnceWith(request);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["labels", "assignees"])(
    "uses complete REST data when an issue has another page of %s",
    async (field) => {
      const value = issue();
      const { service, legacyList } = reader(
        response([
          issue({
            [field]: {
              ...value[field as "labels" | "assignees"],
              pageInfo: { hasNextPage: true },
            },
          }),
        ]),
      );
      await service.list(input());
      expect(legacyList).toHaveBeenCalledExactlyOnceWith(input());
    },
  );

  it("keeps the repository boundary and excludes pull requests", async () => {
    const { service } = reader(
      response([
        issue({
          repository: { nameWithOwner: "other/repository" },
          url: "https://github.com/other/repository/issues/42",
        }),
        { __typename: "PullRequest" },
        issue({ repository: { nameWithOwner: "YU/Arco" }, author: null }),
      ]),
    );
    expect((await service.list(input())).issues).toEqual([
      expect.objectContaining({ repo, author: "ghost" }),
    ]);
  });

  it.each([
    `https://github.com/other/repository/issues/42`,
    `https://example.com/${repo}/issues/42`,
    `https://github.com/${repo}/issues/43`,
    `https://github.com/${repo}/issues/42?redirect=1`,
    `https://github.com/${repo}/issues/42#fragment`,
    `https://user@github.com/${repo}/issues/42`,
  ])("rejects conflicting issue source URL %s", async (url) => {
    const { service } = reader(response([issue({ url })]));
    await expect(service.list(input())).rejects.toThrow(
      "conflicting issue repository identities",
    );
  });

  it.each([
    null,
    { data: null },
    { data: { search: null } },
    response([null]),
    response([
      issue({ labels: { nodes: [null], pageInfo: { hasNextPage: false } } }),
    ]),
    response([issue({ state: "UNKNOWN" })]),
    { ...response(), errors: [{ message: "Partial result" }] },
    response([], { count: 200, cursor: "invalid-empty-page" }),
    {
      data: {
        search: {
          ...response().data.search,
          issueCount: 200,
          pageInfo: { hasNextPage: true, endCursor: null },
        },
      },
    },
  ])("rejects invalid or partial response %j", async (value) => {
    const { service, legacyList } = reader(value);
    await expect(service.list(input())).rejects.toBeInstanceOf(GitHubError);
    expect(legacyList).not.toHaveBeenCalled();
  });

  it("does not mask network or permission errors with a REST retry", async () => {
    const error = new GitHubError("Permission denied", "forbidden");
    const query = vi.fn(async () => {
      throw error;
    });
    const legacyList = vi.fn(async () => ({
      issues: [],
      hasMore: false,
      page: 1,
    }));
    const service = createRepositoryIssueReader({ query, legacyList });
    await expect(service.list(input())).rejects.toBe(error);
    expect(legacyList).not.toHaveBeenCalled();
  });

  it("ends at the existing 1,000-result cap", async () => {
    const { service } = reader(
      response([issue()], { count: 50_000, cursor: "github-cursor-1000" }),
    );
    expect(
      await service.list(input({ page: 10, cursor: "github-cursor-900" })),
    ).toMatchObject({
      page: 10,
      hasMore: false,
    });
    expect(
      await service.list(input({ page: 10, cursor: "github-cursor-900" })),
    ).not.toHaveProperty("nextCursor");
  });

  it("rejects a continuation cursor passed as the first page", async () => {
    const { service, query } = reader();
    await expect(
      service.list(input({ cursor: "unexpected-cursor" })),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(query).not.toHaveBeenCalled();
  });
});
