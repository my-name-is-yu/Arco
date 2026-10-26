import { describe, expect, it, vi } from "vitest";
import { createGitHubAuthSession } from "../src/server/github/auth-session";

describe("opaque GitHub authorization generations", () => {
  it("keeps a stable opaque generation for unchanged credentials and changes it on rotation", async () => {
    const identity = vi.fn().mockResolvedValue("private-token-fingerprint-A");
    const session = createGitHubAuthSession(identity);
    const initial = session.current();
    expect(identity).not.toHaveBeenCalled();
    const first = await session.read();
    expect(first).not.toBe(initial);
    expect(first).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(first).not.toContain("private-token");
    expect(await session.read()).toBe(first);
    identity.mockResolvedValue("private-token-fingerprint-rotated-A");
    const rotated = await session.read();
    expect(rotated).not.toBe(first);
    expect(session.current()).toBe(rotated);
    expect(await session.read()).toBe(rotated);
  });

  it("never reuses an earlier generation after observed A to B to A changes", async () => {
    const identity = vi.fn().mockResolvedValue("private-A");
    const session = createGitHubAuthSession(identity);
    const first = await session.read();
    identity.mockResolvedValue("private-B");
    const second = await session.read();
    identity.mockResolvedValue("private-A");
    const third = await session.read();
    expect(new Set([first, second, third]).size).toBe(3);
    expect(session.current()).toBe(third);
  });

  it("invalidates a known generation once on read failure and assigns a new generation after reconnect", async () => {
    const identity = vi.fn().mockResolvedValue("private-A");
    const session = createGitHubAuthSession(identity);
    const first = await session.read();
    const failure = new Error("Credential reader unavailable");
    identity.mockRejectedValue(failure);
    await expect(session.read()).rejects.toBe(failure);
    const disconnected = session.current();
    expect(disconnected).not.toBe(first);
    await expect(session.read()).rejects.toBe(failure);
    expect(session.current()).toBe(disconnected);
    identity.mockResolvedValue("private-A");
    const reconnected = await session.read();
    expect(new Set([first, disconnected, reconnected]).size).toBe(3);
  });

  it("shares only the in-flight observation so concurrent reads cannot apply out of order", async () => {
    let finish!: (identity: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const identity = vi.fn().mockReturnValue(pending);
    const session = createGitHubAuthSession(identity);
    const one = session.read();
    const two = session.read();
    expect(two).toBe(one);
    await Promise.resolve();
    expect(identity).toHaveBeenCalledOnce();
    finish("private-A");
    const first = await one;
    expect(await two).toBe(first);
    identity.mockResolvedValue("private-B");
    const second = await session.read();
    expect(second).not.toBe(first);
    expect(identity).toHaveBeenCalledTimes(2);
    expect(session.current()).toBe(second);
  });

  it("invalidates after a synchronous identity reader failure just as after a rejection", async () => {
    const identity = vi.fn().mockResolvedValue("private-A");
    const session = createGitHubAuthSession(identity);
    const first = await session.read();
    const failure = new Error("Credential reader unavailable");
    identity.mockImplementation(() => {
      throw failure;
    });
    await expect(session.read()).rejects.toBe(failure);
    const disconnected = session.current();
    expect(disconnected).not.toBe(first);
    await expect(session.read()).rejects.toBe(failure);
    expect(session.current()).toBe(disconnected);
    identity.mockResolvedValue("private-A");
    expect(await session.read()).not.toBe(first);
  });
});
