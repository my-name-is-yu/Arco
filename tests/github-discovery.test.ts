import { describe, expect, it, vi } from "vitest";
import {
  createGitHubService,
  GitHubError,
  type GhRunner,
} from "../src/server/github";
import { createFixtureService, FIXTURE_REPO } from "../src/server/fixture";
import { callDataTool } from "../src/server/tools";

const issue = (repo: string, number: number, extra: object = {}) => ({
  node_id: `I_${repo}_${number}`,
  number,
  title: "Source title",
  state: "open",
  updated_at: "2026-10-23T00:00:00Z",
  html_url: `https://github.com/${repo}/issues/${number}`,
  repository_url: `https://api.github.com/repos/${repo}`,
  user: { login: "source-user" },
  labels: [],
  assignees: [],
  ...extra,
});
const repository = (repo: string, extra: object = {}) => ({
  node_id: `R_${repo}`,
  full_name: repo,
  html_url: `https://github.com/${repo}`,
  private: true,
  archived: false,
  has_issues: true,
  ...extra,
});
const accountInput = {
  filter: "all" as const,
  state: "open" as const,
  sort: "updated" as const,
  order: "desc" as const,
  page: 1,
};

describe("authenticated account discovery", () => {
  it("uses the account endpoint without a repository or per-repository scan and retains each source ref", async () => {
    const run = vi.fn<GhRunner>(async () => [
      issue("owner/private", 42),
      issue("organization/shared", 42),
      issue("owner/private", 43, { pull_request: {} }),
    ]);
    const service = createGitHubService({ run, defaultRepo: "ignored/repo" });
    const page = await callDataTool(service, "arco_account_issues", {
      filter: "all",
    });
    expect(page).toMatchObject({
      scope: "account",
      filter: "all",
      page: 1,
      hasMore: false,
      issues: [
        { repo: "owner/private", number: 42, id: "I_owner/private_42" },
        {
          repo: "organization/shared",
          number: 42,
          id: "I_organization/shared_42",
        },
      ],
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0][3]).toBe(
      "issues?filter=all&state=open&sort=updated&direction=desc&per_page=30&page=1",
    );
    expect(run.mock.calls[0][0]).toContain("GET");
    expect(run.mock.calls[0][0]).not.toContain("--paginate");
    expect(run.mock.calls[0][1]).toBeUndefined();
  });

  it("preserves pagination through a PR-only page without fetching indefinitely or applying search's 1,000-result cap", async () => {
    const run = vi.fn<GhRunner>(async (args) =>
      args[3].endsWith("page=35")
        ? Array.from({ length: 30 }, (_, index) =>
            issue("owner/repository", index + 1, { pull_request: {} }),
          )
        : [issue("second/repository", 1071)],
    );
    const service = createGitHubService({ run });
    expect(
      await service.accountIssues({ ...accountInput, page: 35 }),
    ).toMatchObject({ page: 35, issues: [], hasMore: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      await service.accountIssues({ ...accountInput, page: 36 }),
    ).toMatchObject({
      page: 36,
      issues: [{ repo: "second/repository", number: 1071 }],
      hasMore: false,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("forwards native state/sort/direction and never silently performs an unrelated full-text search", async () => {
    const run = vi.fn<GhRunner>(async () => []);
    const service = createGitHubService({ run });
    await callDataTool(service, "arco_account_issues", {
      state: "all",
      sort: "comments",
      order: "asc",
      page: 4,
    });
    expect(run.mock.calls[0][0][3]).toBe(
      "issues?filter=assigned&state=all&sort=comments&direction=asc&per_page=30&page=4",
    );
    await expect(
      callDataTool(service, "arco_account_issues", { query: "private bug" }),
    ).rejects.toThrow();
    await expect(
      callDataTool(service, "arco_account_issues", { repo: "owner/repo" }),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or conflicting native repository identities", async () => {
    for (const source of [
      issue("owner/repo", 1, { repository_url: undefined }),
      issue("owner/repo", 1, {
        repository_url: "https://example.com/repos/owner/repo",
      }),
      issue("owner/repo", 1, {
        html_url: "https://github.com/different/repo/issues/1",
      }),
      issue("owner/repo", 1, { html_url: "invalid" }),
    ]) {
      const service = createGitHubService({ run: async () => [source] });
      await expect(service.accountIssues(accountInput)).rejects.toBeInstanceOf(
        GitHubError,
      );
    }
  });

  it("discovers one native repository page at a time, including access and availability flags", async () => {
    const source = Array.from({ length: 30 }, (_, index) =>
      repository(`organization/repo-${index}`, {
        archived: index === 1,
        has_issues: index !== 2,
        private: index !== 3,
      }),
    );
    const run = vi.fn<GhRunner>(async (args) =>
      args[3].endsWith("page=1") ? source : [],
    );
    const service = createGitHubService({ run });
    const first = await service.repositories({ page: 1 });
    expect(first.hasMore).toBe(true);
    expect(first.repositories).toHaveLength(30);
    expect(first.repositories[1]).toMatchObject({
      id: "R_organization/repo-1",
      repo: "organization/repo-1",
      private: true,
      archived: true,
    });
    expect(first.repositories[2].issuesEnabled).toBe(false);
    expect(first.repositories[3].private).toBe(false);
    expect(await service.repositories({ page: 2 })).toEqual({
      repositories: [],
      hasMore: false,
      page: 2,
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0][3]).toBe(
      "user/repos?affiliation=owner,collaborator,organization_member&visibility=all&sort=updated&direction=desc&per_page=30&page=1",
    );
    expect(run.mock.calls.every(([args]) => args.includes("GET"))).toBe(true);
    await expect(
      createGitHubService({
        run: async () => [
          repository("organization/repo", {
            html_url: "https://github.com/different/repo",
          }),
        ],
      }).repositories({ page: 1 }),
    ).rejects.toThrow("repository identities");
  });

  it("keeps authentication failures and empty real responses distinct from the fixture", async () => {
    const run = vi.fn<GhRunner>(async () => {
      throw new GitHubError("Existing authentication is unavailable.", "auth");
    });
    const service = createGitHubService({ run });
    await expect(service.accountIssues(accountInput)).rejects.toMatchObject({
      code: "auth",
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      await createGitHubService({ run: async () => [] }).accountIssues(
        accountInput,
      ),
    ).toEqual({
      issues: [],
      hasMore: false,
      page: 1,
      scope: "account",
      filter: "all",
    });
    const fixture = createFixtureService();
    expect((await fixture.connection()).mode).toBe("fixture");
    expect((await fixture.accountIssues(accountInput)).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ repo: FIXTURE_REPO })]),
    );
    expect(await callDataTool(fixture, "arco_repositories", {})).toMatchObject({
      repositories: [{ repo: FIXTURE_REPO }],
      page: 1,
      hasMore: false,
    });
  });

  it("uses assigned by default and keeps the three personal buckets distinct from all accessible", async () => {
    const run = vi.fn<GhRunner>(async () => []);
    const service = createGitHubService({ run });
    expect(
      await callDataTool(service, "arco_account_issues", {}),
    ).toMatchObject({
      scope: "account",
      filter: "assigned",
    });
    for (const filter of ["created", "mentioned", "all"] as const)
      expect(
        await callDataTool(service, "arco_account_issues", { filter }),
      ).toMatchObject({ scope: "account", filter });
    expect(
      run.mock.calls.map(([args]) =>
        new URL(`https://api.github.com/${args[3]}`).searchParams.get("filter"),
      ),
    ).toEqual(["assigned", "created", "mentioned", "all"]);
    const fixture = createFixtureService();
    for (const [filter, numbers] of [
      ["assigned", [42]],
      ["created", [42, 41]],
      ["mentioned", [43]],
      ["all", [42, 43, 41]],
    ] as const) {
      const page = await fixture.accountIssues({
        ...accountInput,
        state: "all",
        filter,
      });
      expect(page.issues.map((issue) => issue.number)).toEqual(numbers);
    }
  });
});
