import { describe, expect, it, vi } from "vitest";
import { createGitHubOperations } from "../src/server/github-operations";
import { createGitHubAuthSession } from "../src/server/github/auth-session";
import {
  createGitHubService,
  GitHubError,
  type GhRunner,
} from "../src/server/github";

describe("GitHub connection read scope", () => {
  it("retains one generation for the same credential and rotates even for the same account", async () => {
    let credential = "private-credential-a";
    const identity = vi.fn(async () => credential);
    const run = vi.fn<GhRunner>(async () => ({ login: "same-account", id: 1 }));
    const service = createGitHubService({ run, credentialIdentity: identity });
    const first = await service.connection();
    expect(first.connected).toBe(true);
    expect((await service.connection()).authGeneration).toBe(
      first.authGeneration,
    );
    credential = "private-credential-b";
    const rotated = await service.connection();
    expect(rotated.account).toBe(first.account);
    expect(rotated.authGeneration).not.toBe(first.authGeneration);
    expect(JSON.stringify(rotated)).not.toContain("private-credential");
    credential = "private-credential-a";
    expect((await service.connection()).authGeneration).not.toBe(
      first.authGeneration,
    );
  });

  it("does not associate a user read with a generation observed only after that read", async () => {
    let credential = "credential-a";
    const run = vi.fn<GhRunner>(async () => {
      credential = "credential-b";
      return { login: "old-account", id: 1 };
    });
    const service = createGitHubService({
      run,
      credentialIdentity: async () => credential,
    });
    const result = await service.connection();
    expect(result.connected).toBe(false);
    expect(result.account).toBeNull();
    expect(result.authGeneration).toBe(await service.authGeneration!());
    expect(result.message).toContain("authentication changed");
  });

  it("keeps a transient provider error in the same credential generation", async () => {
    let unavailable = false;
    const service = createGitHubService({
      credentialIdentity: async () => "same-credential",
      run: async () => {
        if (unavailable)
          throw new GitHubError("Temporarily unavailable", "unavailable");
        return { login: "account", id: 1 };
      },
    });
    const first = await service.connection();
    expect(first.connected).toBe(true);
    unavailable = true;
    const failed = await service.connection();
    expect(failed.connected).toBe(false);
    expect(failed.authGeneration).toBe(first.authGeneration);
  });
});

describe("GitHub read completion authorization", () => {
  it("rejects old label definitions after a shared connection observes another account", async () => {
    let credential = "credential-a";
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const run: GhRunner = async (args) => {
      const endpoint = args[3];
      if (endpoint === "user")
        return { login: credential, id: credential === "credential-a" ? 1 : 2 };
      if (endpoint === "repos/fictional/scope/labels?per_page=100") {
        const account = credential;
        started();
        await held;
        return [
          [
            {
              id: 1,
              name: `Private label for ${account}`,
              color: "123456",
              description: null,
            },
          ],
        ];
      }
      throw new Error(`Unexpected fictional request: ${endpoint}`);
    };
    const authSession = createGitHubAuthSession(async () => credential);
    const service = createGitHubService({ run, authSession });
    const operations = createGitHubOperations({ service, run, authSession });
    await service.connection();
    const oldRead = operations.labelDefinitions({ repo: "fictional/scope" });
    const checked = expect(oldRead).rejects.toMatchObject({ code: "auth" });
    await reading;
    credential = "credential-b";
    await service.connection();
    release();
    await checked;
    expect(
      await operations.labelDefinitions({ repo: "fictional/scope" }),
    ).toMatchObject({
      labels: [{ name: "Private label for credential-b" }],
    });
  });

  it("rejects an old issue read after the new account has been observed", async () => {
    let credential = "credential-a";
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const repo = "fictional/scope";
    const run: GhRunner = async (args) => {
      const endpoint = args[3];
      if (endpoint === "user")
        return { login: credential, id: credential === "credential-a" ? 1 : 2 };
      if (endpoint === `repos/${repo}/issues/1`) {
        const account = credential;
        started();
        await held;
        return {
          node_id: "issue-1",
          number: 1,
          title: `Private issue for ${account}`,
          state: "open",
          updated_at: "2026-10-26T00:00:00Z",
          html_url: `https://github.com/${repo}/issues/1`,
          user: { login: account },
          body: "Original account content",
          labels: [],
          assignees: [],
        };
      }
      if (endpoint.includes("/comments?")) return [];
      if (endpoint === "graphql")
        return {
          data: {
            repository: {
              issue: {
                id: "issue-1",
                projectItems: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        };
      throw new Error(`Unexpected fictional request: ${endpoint}`);
    };
    const service = createGitHubService({
      run,
      credentialIdentity: async () => credential,
    });
    await service.connection();
    const oldRead = service.get({ repo, number: 1 });
    const checked = expect(oldRead).rejects.toMatchObject({
      code: "auth",
      message: expect.stringContaining("authentication changed"),
    });
    await reading;
    credential = "credential-b";
    expect(await service.connection()).toMatchObject({
      connected: true,
      account: "credential-b",
    });
    release();
    await checked;
    expect(await service.get({ repo, number: 1 })).toMatchObject({
      author: "credential-b",
      title: "Private issue for credential-b",
    });
  });
});
