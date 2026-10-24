import { describe, expect, it, vi } from "vitest";
import { createGitHubService, type GhRunner } from "../src/server/github";

const nativeIssue = {
  node_id: "I_account",
  number: 1,
  title: "Account issue",
  state: "open",
  updated_at: "2026-10-24T00:00:00Z",
  html_url: "https://github.com/owner/repo/issues/1",
  repository_url: "https://api.github.com/repos/owner/repo",
  user: { login: "owner" },
  labels: [],
  assignees: [],
};
const response = (items: unknown[]) =>
  `HTTP/2.0 200 OK\r\nETag: W/"account-page"\r\n\r\n${JSON.stringify(items)}`;
const input = {
  filter: "all" as const,
  state: "open" as const,
  sort: "updated" as const,
  order: "desc" as const,
  page: 1,
};

describe("conditional account reads through the GitHub service", () => {
  it("reuses a validated native page on 304 and isolates rotated credentials", async () => {
    let credential = "first-credential";
    const run = vi.fn<GhRunner>(async (args) =>
      args.some((arg) => arg.startsWith("If-None-Match:"))
        ? "HTTP/2.0 304 Not Modified\r\n\r\n"
        : response(
            credential === "first-credential"
              ? Array.from({ length: 100 }, (_, index) => ({
                  ...nativeIssue,
                  ...(index ? { pull_request: {} } : {}),
                }))
              : [],
          ),
    );
    const service = createGitHubService({
      run,
      credentialIdentity: async () => credential,
    });
    const first = await service.accountIssues(input);
    expect(first.issues).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(await service.accountIssues(input)).toEqual(first);
    expect(run.mock.calls[1][0]).toContain('If-None-Match: W/"account-page"');
    credential = "same-user-new-credential";
    expect(await service.accountIssues(input)).toMatchObject({
      issues: [],
      hasMore: false,
    });
    expect(
      run.mock.calls[2][0].some((arg) => arg.startsWith("If-None-Match:")),
    ).toBe(false);
  });

  it("rejects a response when authentication changes during the request", async () => {
    let credential = "before";
    const run = vi.fn<GhRunner>(async () => {
      credential = "after";
      return response([nativeIssue]);
    });
    const service = createGitHubService({
      run,
      credentialIdentity: async () => credential,
    });
    await expect(service.accountIssues(input)).rejects.toMatchObject({
      code: "auth",
    });
    expect((await service.accountIssues(input)).issues).toHaveLength(1);
    expect(
      run.mock.calls[1][0].some((arg) => arg.startsWith("If-None-Match:")),
    ).toBe(false);
  });
});
