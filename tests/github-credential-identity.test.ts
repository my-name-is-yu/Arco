import { describe, expect, it } from "vitest";
import { credentialIdentity } from "../src/server/github/credential-identity";

describe("private GitHub cache identity", () => {
  it("isolates credentials even when the account name stays the same", async () => {
    const first = await credentialIdentity(async () => "credential-a\n");
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(await credentialIdentity(async () => "credential-a"));
    expect(first).not.toBe(
      await credentialIdentity(async () => "credential-b"),
    );
    expect(first).not.toContain("credential-a");
  });

  it("never includes credential output or subprocess errors in failures", async () => {
    await expect(credentialIdentity(async () => "\n")).rejects.toMatchObject({
      code: "auth",
    });
    await expect(
      credentialIdentity(async () => {
        throw new Error("secret subprocess output");
      }),
    ).rejects.toMatchObject({
      code: "auth",
      message:
        "Unable to verify GitHub authentication. Check gh auth login and refresh.",
    });
  });
});
