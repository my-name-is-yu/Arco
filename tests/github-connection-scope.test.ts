import { describe, expect, it, vi } from "vitest";
import {
  createGitHubService,
  GitHubError,
  type GhRunner,
} from "../src/server/github";

describe("GitHub connection read scope", () => {
  it("retains one generation for the same credential and rotates even for the same account", async () => {
    let credential = "private-credential-a";
    const identity = vi.fn(async () => credential);
    const run = vi.fn<GhRunner>(async () => ({ login: "same-account" }));
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
      return { login: "old-account" };
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
        return { login: "account" };
      },
    });
    const first = await service.connection();
    unavailable = true;
    const failed = await service.connection();
    expect(failed.connected).toBe(false);
    expect(failed.authGeneration).toBe(first.authGeneration);
  });
});
