import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createLinearAuth,
  createPkce,
  validState,
  type CredentialStore,
  type LinearCredential,
  type LinearAuth,
} from "../src/server/linear/auth";

const directories: string[] = [];
const authorizations: LinearAuth[] = [];
afterEach(async () => {
  for (const auth of authorizations.splice(0)) auth.close();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "arco-linear-auth-test-"));
  directories.push(path);
  return path;
}
function memoryStore(initial: LinearCredential | null = null) {
  let credential = structuredClone(initial);
  return {
    read: vi.fn<CredentialStore["read"]>(async () =>
      structuredClone(credential),
    ),
    write: vi.fn(async (_id: string, next: LinearCredential) => {
      credential = structuredClone(next);
    }),
    remove: vi.fn<CredentialStore["remove"]>(async () => {
      credential = null;
    }),
  } satisfies CredentialStore;
}
async function callbackUri() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test loopback unavailable");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${address.port}/oauth/linear/callback`;
}
const response = () =>
  Response.json({
    access_token: "fake-access-next",
    refresh_token: "fake-refresh-next",
    expires_in: 86400,
    scope: "read write",
  });
describe("Linear PKCE and local authorization", () => {
  it("uses S256, independent unpredictable state, and exact state comparison", () => {
    const first = createPkce();
    const second = createPkce();
    expect(first.verifier).toHaveLength(43);
    expect(first.challenge).toBe(
      createHash("sha256").update(first.verifier).digest("base64url"),
    );
    expect(first.state).not.toBe(second.state);
    expect(validState(first.state, first.state)).toBe(true);
    expect(validState(`${first.state}x`, first.state)).toBe(false);
    expect(validState(null, first.state)).toBe(false);
  });
  it("reports an occupied callback port as failed and can retry after it is released", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test loopback unavailable");
    const uri = `http://127.0.0.1:${address.port}/oauth/linear/callback`;
    const store = memoryStore();
    const http = vi.fn<typeof fetch>(async () => response());
    const auth = createLinearAuth({
      store,
      directory: await directory(),
      fetch: http,
    });
    authorizations.push(auth);
    const message =
      "The Linear callback port could not be opened. Complete any other connection attempt and try again.";
    try {
      await expect(
        auth.begin("port-retry", "client", uri),
      ).rejects.toMatchObject({
        code: "unavailable",
        message,
      });
      expect(auth.status("port-retry")).toEqual({ state: "failed", message });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await auth.begin("port-retry", "client", uri)).toMatchObject({
      connectionId: "port-retry",
      redirectUri: uri,
    });
    expect(auth.status("port-retry")).toEqual({
      state: "pending",
      message: "",
    });
    expect(http).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });
  it("rejects wrong state, then exchanges the valid callback without a client secret and closes it", async () => {
    const store = memoryStore();
    const http = vi.fn<typeof fetch>(async () => response());
    const auth = createLinearAuth({
      store,
      directory: await directory(),
      fetch: http,
      now: () => 1000,
    });
    authorizations.push(auth);
    const uri = await callbackUri();
    const started = await auth.begin("test-connection", "public-client", uri);
    const authorize = new URL(started.authorizationUrl);
    expect(authorize.searchParams.get("scope")).toBe("read,write");
    expect(authorize.searchParams.get("actor")).toBe("user");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const bad = await fetch(`${uri}?code=fake-code&state=wrong`);
    expect(bad.status).toBe(400);
    expect(store.write).not.toHaveBeenCalled();
    const accepted = await fetch(
      `${uri}?code=fake-code&state=${authorize.searchParams.get("state")}`,
    );
    expect(accepted.status).toBe(200);
    expect(auth.status("test-connection")).toEqual({
      state: "connected",
      message: "",
    });
    const form = http.mock.calls[0][1]?.body;
    expect(form).toBeInstanceOf(URLSearchParams);
    expect(String(form)).not.toContain("client_secret");
    expect(String(form)).toContain("code_verifier=");
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(await auth.accessToken("test-connection")).toBe("fake-access-next");
    await expect(fetch(uri)).rejects.toThrow();
    expect(JSON.stringify(auth.status("test-connection"))).not.toMatch(
      /fake-code|verifier|access|refresh/,
    );
  });
  it("leaves no credential after denied consent or OS-store failure", async () => {
    const store = memoryStore();
    const auth = createLinearAuth({
      store,
      directory: await directory(),
      fetch: vi.fn<typeof fetch>(async () => response()),
    });
    authorizations.push(auth);
    const uri = await callbackUri();
    const started = await auth.begin("denied", "client", uri);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    expect(
      (await fetch(`${uri}?error=access_denied&state=${state}`)).status,
    ).toBe(400);
    expect(store.write).not.toHaveBeenCalled();
    expect(auth.status("denied").state).toBe("failed");
    store.write.mockRejectedValueOnce(
      new Error("OS credential storage unavailable"),
    );
    const second = await auth.begin("store-failed", "client", uri);
    const secondState = new URL(second.authorizationUrl).searchParams.get(
      "state",
    );
    expect((await fetch(`${uri}?code=fake&state=${secondState}`)).status).toBe(
      400,
    );
    expect(await auth.hasConnection("store-failed")).toBe(false);
    expect(auth.status("store-failed").state).toBe("failed");
  });
  it("serializes refresh through connection lock and rereads the complete token pair", async () => {
    const store = memoryStore({
      clientId: "client",
      accessToken: "fake-expired",
      refreshToken: "fake-old-refresh",
      expiresAt: 0,
      scopes: ["read", "write"],
    });
    const http = vi.fn<typeof fetch>(async () => response());
    const path = await directory();
    const first = createLinearAuth({
      store,
      directory: path,
      fetch: http,
      now: () => 1000,
    });
    const second = createLinearAuth({
      store,
      directory: path,
      fetch: http,
      now: () => 1000,
    });
    authorizations.push(first, second);
    expect(
      await Promise.all([
        first.accessToken("same"),
        second.accessToken("same"),
      ]),
    ).toEqual(["fake-access-next", "fake-access-next"]);
    expect(http).toHaveBeenCalledTimes(1);
    expect(store.write).toHaveBeenCalledWith(
      "same",
      expect.objectContaining({
        accessToken: "fake-access-next",
        refreshToken: "fake-refresh-next",
      }),
    );
    expect(String(http.mock.calls[0][1]?.body)).toContain(
      "grant_type=refresh_token",
    );
    expect(String(http.mock.calls[0][1]?.body)).not.toContain("client_secret");
  });
  it("keeps the old pair when refresh fails and distinguishes local disconnect from provider revoke", async () => {
    const initial = {
      clientId: "client",
      accessToken: "fake-old",
      refreshToken: "fake-refresh",
      expiresAt: 0,
      scopes: ["read", "write"],
    };
    const store = memoryStore(initial);
    const http = vi.fn<typeof fetch>(
      async () => new Response("", { status: 401 }),
    );
    const auth = createLinearAuth({
      store,
      directory: await directory(),
      fetch: http,
    });
    authorizations.push(auth);
    await expect(auth.accessToken("connection")).rejects.toThrow("Reconnect");
    expect(store.write).not.toHaveBeenCalled();
    expect(await store.read("connection")).toEqual(initial);
    expect(await auth.disconnect("connection")).toEqual({
      disconnected: true,
      providerRevoked: false,
    });
    expect(http).toHaveBeenCalledTimes(1);
    const secondStore = memoryStore(initial);
    const secondHttp = vi.fn<typeof fetch>(
      async () => new Response("", { status: 200 }),
    );
    const second = createLinearAuth({
      store: secondStore,
      directory: await directory(),
      fetch: secondHttp,
    });
    authorizations.push(second);
    expect(await second.disconnect("connection", true)).toEqual({
      disconnected: true,
      providerRevoked: true,
    });
    expect(String(secondHttp.mock.calls[0][1]?.body)).toBe(
      "token=fake-refresh&token_type_hint=refresh_token",
    );
  });
  it("keeps local credentials when a generic provider 400 does not confirm revocation", async () => {
    const initial = {
      clientId: "client",
      accessToken: "fake-access",
      refreshToken: "fake-refresh",
      expiresAt: 100_000,
      scopes: ["read", "write"],
    };
    const store = memoryStore(initial);
    const auth = createLinearAuth({
      store,
      directory: await directory(),
      fetch: vi.fn<typeof fetch>(async () => new Response("", { status: 400 })),
    });
    authorizations.push(auth);
    await expect(auth.disconnect("connection", true)).rejects.toMatchObject({
      code: "uncertain",
      message: expect.stringContaining(
        "Check your connection in Linear before trying again.",
      ),
    });
    expect(await store.read("connection")).toEqual(initial);
    expect(store.remove).not.toHaveBeenCalled();
  });
  it.each([
    [401, "auth", "Reconnect to Linear"],
    [403, "forbidden", "Check your Linear permissions"],
    [429, "rate-limited", "Wait and reconnect"],
    [503, "unavailable", "Check your connection and try again"],
  ])(
    "classifies token refresh rejection %s and preserves credentials",
    async (status, code, action) => {
      const initial = {
        clientId: "client",
        accessToken: "private-expired-access",
        refreshToken: "private-refresh-token",
        expiresAt: 0,
        scopes: ["read", "write"],
      };
      const store = memoryStore(initial);
      const http = vi.fn<typeof fetch>(
        async () => new Response("private-response", { status }),
      );
      const auth = createLinearAuth({
        store,
        directory: await directory(),
        fetch: http,
      });
      authorizations.push(auth);
      const failure = await auth
        .accessToken("connection")
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code,
        message: expect.stringContaining(action),
      });
      expect((failure as Error).message).not.toContain("private-");
      expect(store.write).not.toHaveBeenCalled();
      expect(await store.read("connection")).toEqual(initial);
      expect(http).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects delayed authorization after close while allowing an existing grant to refresh", async () => {
    const store = memoryStore({
      clientId: "client",
      accessToken: "fake-expired-access",
      refreshToken: "fake-refresh",
      expiresAt: 0,
      scopes: ["read", "write"],
    });
    const auth = createLinearAuth({
      store,
      directory: await directory(),
      fetch: vi.fn<typeof fetch>(async () => response()),
    });
    authorizations.push(auth);
    auth.close();
    await expect(
      auth.begin("delayed", "client", await callbackUri()),
    ).rejects.toMatchObject({ code: "auth" });
    await expect(auth.accessToken("existing")).resolves.toBe(
      "fake-access-next",
    );
    expect(store.write).toHaveBeenCalledOnce();
  });

  it("settles authorization cancelled while the callback listener is starting", async () => {
    const auth = createLinearAuth({
      store: memoryStore(),
      directory: await directory(),
    });
    authorizations.push(auth);
    const starting = auth.begin("starting", "client", await callbackUri());
    auth.close();
    await expect(starting).rejects.toMatchObject({ code: "auth" });
  });

  it.each(["disconnect", "close"] as const)(
    "does not save an in-flight callback credential after %s cancels it",
    async (action) => {
      const store = memoryStore();
      let releaseExchange!: () => void;
      let exchangeStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        exchangeStarted = resolve;
      });
      const held = new Promise<void>((resolve) => {
        releaseExchange = resolve;
      });
      const auth = createLinearAuth({
        store,
        directory: await directory(),
        fetch: vi.fn<typeof fetch>(async () => {
          exchangeStarted();
          await held;
          return response();
        }),
      });
      authorizations.push(auth);
      const uri = await callbackUri();
      const begin = await auth.begin("cancelled", "client", uri);
      const state = new URL(begin.authorizationUrl).searchParams.get("state");
      const callback = fetch(`${uri}?code=fake-code&state=${state}`);
      await started;
      const cancelled =
        action === "disconnect" ? auth.disconnect("cancelled") : auth.close();
      releaseExchange();
      expect((await callback).status).toBe(400);
      await cancelled;
      expect(store.write).not.toHaveBeenCalled();
      expect(await store.read("cancelled")).toBeNull();
      if (action === "disconnect")
        expect(auth.status("cancelled").state).toBe("idle");
    },
  );
});
