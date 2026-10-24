import { describe, expect, it, vi } from "vitest";
import {
  createGitHubTransport,
  GitHubError,
  type GhRunner,
} from "../src/server/github/transport";

describe("GitHub transport contracts", () => {
  it("applies an output projection only to explicit projected GET reads", async () => {
    const run = vi.fn<GhRunner>(async () => null);
    const transport = createGitHubTransport({ run, policy: "core" });
    const projection = "[.[] | {node_id, title}]";
    await transport.read("issues?per_page=100&page=1", projection);
    await transport.request("read", "repos/owner/repo/issues/1");
    await transport.request(
      "read",
      "repos/owner/repo/issues/1/comments?per_page=30&page=2",
    );
    await transport.query("query Detail { viewer { login } }", {});
    await transport.request("write", "repos/owner/repo/issues/1", "PATCH", {
      body: "Full body remains available",
    });
    expect(run.mock.calls[0][0]).toEqual(
      expect.arrayContaining(["--method", "GET", "--jq", projection]),
    );
    expect(run.mock.calls[0][0]).not.toContain("--paginate");
    expect(run.mock.calls[0][1]).toBeUndefined();
    expect(
      run.mock.calls.slice(1).every(([args]) => !args.includes("--jq")),
    ).toBe(true);
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

  it("uses explicit access for POST reads and uncertain mutations, independent of query text", async () => {
    const run = vi.fn<GhRunner>(async () => {
      throw new GitHubError("Denied", "forbidden");
    });
    const transport = createGitHubTransport({ run, policy: "extended" });
    await expect(
      transport.query("query NativeRead { viewer { login } }", {}),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      transport.mutate("mutation NativeWrite { save }", {}),
    ).rejects.toMatchObject({ code: "uncertain" });
    await expect(
      transport.request("read", "graphql", "POST", {
        query: "mutation-shaped untrusted text",
      }),
    ).rejects.toMatchObject({ message: "Denied", code: "forbidden" });
    await expect(
      transport.request("write", "repos/owner/repo/issues/1", "PATCH", {}),
    ).rejects.toMatchObject({ code: "uncertain" });
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
});
