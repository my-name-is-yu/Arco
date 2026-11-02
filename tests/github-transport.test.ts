import { describe, expect, it, vi } from "vitest";
import {
  createGitHubTransport,
  createGitHubWriteGuard,
  commandError,
  GitHubError,
  type GhRunner,
} from "../src/server/github/transport";

describe("GitHub transport contracts", () => {
  it("keeps detail, comment, GraphQL and write responses unprojected", async () => {
    const run = vi.fn<GhRunner>(async () => null);
    const transport = createGitHubTransport({ run, policy: "core" });
    await transport.request("read", "repos/owner/repo/issues/1");
    await transport.request(
      "read",
      "repos/owner/repo/issues/1/comments?per_page=30&page=2",
    );
    await transport.query("query Detail { viewer { login } }", {});
    await transport.request("write", "repos/owner/repo/issues/1", "PATCH", {
      body: "Full body remains available",
    });
    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls.every(([args]) => !args.includes("--jq"))).toBe(true);
  });

  it("keeps the existing core and extended header policies, pagination, and JSON stdin", async () => {
    const run = vi.fn<GhRunner>(async () => null);
    const core = createGitHubTransport({ run, policy: "core" });
    const extended = createGitHubTransport({ run, policy: "extended" });
    await core.request("read", "repos/owner/repo/issues");
    await extended.request(
      "read",
      "repos/owner/repo/labels",
      "GET",
      undefined,
      true,
    );
    await core.request("write", "repos/owner/repo/issues/1", "PATCH", {
      body: "`literal` $input\nsecond line",
    });
    expect(run.mock.calls[0][0]).not.toContain(
      "X-GitHub-Api-Version: 2026-03-10",
    );
    expect(run.mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        "--header",
        "X-GitHub-Api-Version: 2026-03-10",
        "--paginate",
        "--slurp",
      ]),
    );
    expect(run.mock.calls[2][0]).toEqual(
      expect.arrayContaining(["--input", "-"]),
    );
    expect(run.mock.calls[2][0]).not.toContain("`literal` $input\nsecond line");
    expect(JSON.parse(run.mock.calls[2][1]!)).toEqual({
      body: "`literal` $input\nsecond line",
    });
  });

  it("keeps definitive rejections distinct from uncertain mutation outcomes", async () => {
    const run = vi.fn<GhRunner>(async () => {
      throw new GitHubError("Denied", "forbidden");
    });
    const transport = createGitHubTransport({ run, policy: "extended" });
    await expect(
      transport.query("query NativeRead { viewer { login } }", {}),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      transport.mutate("mutation NativeWrite { save }", {}),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      transport.request("read", "graphql", "POST", {
        query: "mutation-shaped untrusted text",
      }),
    ).rejects.toMatchObject({ message: "Denied", code: "forbidden" });
    await expect(
      transport.request("write", "repos/owner/repo/issues/1", "PATCH", {}),
    ).rejects.toMatchObject({ code: "forbidden" });
    run.mockRejectedValueOnce(new GitHubError("Request timed out", "timeout"));
    await expect(
      transport.mutate("mutation Save { save }", {}),
    ).rejects.toMatchObject({ code: "uncertain" });
    run.mockRejectedValueOnce(
      new Error("Bearer private-secret network detail"),
    );
    await expect(
      transport.mutate("mutation Save { save }", {}),
    ).rejects.toMatchObject({
      code: "uncertain",
      message: expect.not.stringContaining("private-secret"),
    });
    expect(run).toHaveBeenCalledTimes(6);
  });

  it("treats partial GraphQL results as failed reads or uncertain writes", async () => {
    const run = vi.fn<GhRunner>(async () => ({
      data: { partial: true },
      errors: [{ message: "Denied" }],
    }));
    for (const policy of ["core", "extended"] as const) {
      const transport = createGitHubTransport({ run, policy });
      await expect(
        transport.query("query NativeRead { viewer { login } }", {}),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        transport.mutate("mutation NativeWrite { save }", {}),
      ).rejects.toMatchObject({ code: "uncertain" });
    }
  });

  it.each([
    ["gh: API rate limit exceeded (HTTP 403) private-token", "rate-limited"],
    ["gh: You have exceeded a secondary rate limit (HTTP 403)", "rate-limited"],
    ["gh: Too many requests (HTTP 429)", "rate-limited"],
    ["gh: Resource not accessible by integration (HTTP 403)", "forbidden"],
    ["gh: Bad credentials (HTTP 401)", "auth"],
    ["gh: Not Found (HTTP 404)", "not-found"],
    ["gh: Validation Failed (HTTP 422)", "invalid-input"],
    ["gh: Conflict (HTTP 409)", "conflict"],
    ["gh: context deadline exceeded private-token", "timeout"],
    ["gh: upstream private-token (HTTP 503)", "unavailable"],
  ])("classifies CLI rejection without exposing stderr: %s", (stderr, code) => {
    const error = commandError(stderr);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain("private-token");
  });

  it("keeps mutation partial success uncertain even if a rate-limit error is present", async () => {
    const run = vi.fn<GhRunner>(async () => ({
      errors: [{ type: "RATE_LIMITED" }],
    }));
    const transport = createGitHubTransport({ run, policy: "core" });
    await expect(
      transport.query("query Read { viewer { login } }", {}),
    ).rejects.toMatchObject({ code: "rate-limited" });
    await expect(
      transport.mutate("mutation Write { save }", {}),
    ).rejects.toMatchObject({ code: "rate-limited" });
    run.mockResolvedValueOnce({
      data: { save: { id: "saved" } },
      errors: [{ type: "RATE_LIMITED" }],
    });
    await expect(
      transport.mutate("mutation Write { save }", {}),
    ).rejects.toMatchObject({ code: "uncertain" });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("allows retry after a GraphQL rate rejection but retains an ambiguous partial mutation", async () => {
    const run = vi.fn<GhRunner>(async () => ({
      errors: [{ type: "RATE_LIMITED" }],
    }));
    const transport = createGitHubTransport({ run, policy: "extended" });
    const once = createGitHubWriteGuard<unknown>(async () => "test-credential");
    const write = () => transport.mutate("mutation Save { save }", {});
    await expect(once("rate-rejected", {}, write)).rejects.toMatchObject({
      code: "rate-limited",
    });
    run.mockResolvedValueOnce({ data: { save: { id: "saved" } } });
    await expect(once("rate-rejected", {}, write)).resolves.toEqual({
      data: { save: { id: "saved" } },
    });
    expect(run).toHaveBeenCalledTimes(2);

    run.mockResolvedValueOnce({
      data: { save: { id: "saved" } },
      errors: [{ type: "RATE_LIMITED" }],
    });
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(once("partial-mutation", {}, write)).rejects.toMatchObject({
        code: "uncertain",
      });
    expect(run).toHaveBeenCalledTimes(3);
  });
});
