import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createLinearAuth,
  type CredentialStore,
  type LinearAuth,
  type LinearCredential,
} from "../src/server/linear/auth";
import { LinearServiceError } from "../src/server/linear/errors";
import { createLinearService } from "../src/server/linear/service";

const alias = "fictional-connection";
const directories: string[] = [];
const authorizations: LinearAuth[] = [];
afterEach(async () => {
  authorizations.splice(0).forEach((auth) => auth.close());
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function credential(): LinearCredential {
  return {
    clientId: "fictional-client",
    accessToken: "fictional-access",
    refreshToken: "fictional-refresh",
    expiresAt: Date.now() + 3_600_000,
    scopes: ["read", "write"],
  };
}

async function setup(initial: LinearCredential | null = credential()) {
  const directory = await mkdtemp(join(tmpdir(), "arco-authorization-scope-"));
  directories.push(directory);
  const values = new Map<string, LinearCredential>();
  if (initial) values.set(alias, structuredClone(initial));
  const writes: LinearCredential[] = [];
  const controls = { failWrite: false, failRemove: false };
  const store: CredentialStore = {
    async read(id) {
      return structuredClone(values.get(id) ?? null);
    },
    async write(id, value) {
      if (controls.failWrite)
        throw new LinearServiceError(
          "Fictional store write failure.",
          "storage",
        );
      writes.push(structuredClone(value));
      values.set(id, structuredClone(value));
    },
    async remove(id) {
      if (controls.failRemove)
        throw new LinearServiceError(
          "Fictional store remove failure.",
          "storage",
        );
      values.delete(id);
    },
  };
  const makeAuth = () => {
    const auth = createLinearAuth({
      directory,
      store,
      fetch: async () =>
        Response.json({
          access_token: "fictional-next-access",
          refresh_token: "fictional-next-refresh",
          expires_in: 3600,
          scope: "read write",
        }),
    });
    authorizations.push(auth);
    return auth;
  };
  return { auth: makeAuth(), makeAuth, store, writes, controls };
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

async function authorize(auth: LinearAuth) {
  const uri = await callbackUri();
  const started = await auth.begin(alias, "fictional-client", uri);
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  return fetch(`${uri}?code=fictional-code&state=${state}`);
}

describe("Linear authorization scope", () => {
  it("assigns each successful OAuth grant a new private identity", async () => {
    const { auth, store } = await setup(null);
    expect((await authorize(auth)).status).toBe(200);
    const first = await store.read(alias);
    expect(first?.authorizationId).toEqual(expect.any(String));
    expect(await auth.sessionScope(alias)).toBe(first?.authorizationId);
    expect((await authorize(auth)).status).toBe(200);
    const second = await store.read(alias);
    expect(second?.accessToken).toBe(first?.accessToken);
    expect(second?.authorizationId).not.toBe(first?.authorizationId);
  });

  it.each(["same", "another"] as const)(
    "preserves the grant identity when %s auth instance rotates its token pair",
    async (instance) => {
      const authorizationId = randomUUID();
      const { auth, makeAuth, store } = await setup({
        ...credential(),
        authorizationId,
      });
      await (instance === "same" ? auth : makeAuth()).refresh(alias);
      expect(await store.read(alias)).toMatchObject({
        authorizationId,
        accessToken: "fictional-next-access",
        refreshToken: "fictional-next-refresh",
      });
      expect(await auth.sessionScope(alias)).toBe(authorizationId);
    },
  );

  it("migrates a legacy record once across auth instances sharing its lock and store", async () => {
    const { auth, makeAuth, writes, store } = await setup();
    const second = makeAuth();
    const scopes = await Promise.all([
      auth.sessionScope(alias),
      second.sessionScope(alias),
    ]);
    expect(scopes[0]).toEqual(expect.any(String));
    expect(scopes[0]).toBe(scopes[1]);
    expect(writes).toHaveLength(1);
    expect((await store.read(alias))?.authorizationId).toBe(scopes[0]);
  });

  it("rereads the shared record rather than retaining another instance's old grant", async () => {
    const { auth, makeAuth, store } = await setup({
      ...credential(),
      authorizationId: randomUUID(),
    });
    const first = await auth.sessionScope(alias);
    const second = makeAuth();
    expect((await authorize(second)).status).toBe(200);
    const replacement = await store.read(alias);
    expect(await auth.sessionScope(alias)).toBe(replacement?.authorizationId);
    expect(await auth.sessionScope(alias)).not.toBe(first);
    await second.disconnect(alias);
    await expect(auth.sessionScope(alias)).rejects.toMatchObject({
      code: "auth",
    });
  });

  it("fails a legacy upgrade without mutating a record when the store write fails", async () => {
    const { auth, store, writes, controls } = await setup();
    const initial = await store.read(alias);
    controls.failWrite = true;
    await expect(auth.sessionScope(alias)).rejects.toMatchObject({
      code: "storage",
    });
    expect(await store.read(alias)).toEqual(initial);
    expect(writes).toEqual([]);
    controls.failWrite = false;
    expect(await auth.sessionScope(alias)).toEqual(expect.any(String));
    expect(writes).toHaveLength(1);
  });

  it("keeps the grant when disconnect cannot remove its stored credential", async () => {
    const authorizationId = randomUUID();
    const { auth, store, controls } = await setup({
      ...credential(),
      authorizationId,
    });
    controls.failRemove = true;
    await expect(auth.disconnect(alias)).rejects.toMatchObject({
      code: "storage",
    });
    expect(await auth.sessionScope(alias)).toBe(authorizationId);
    expect((await store.read(alias))?.authorizationId).toBe(authorizationId);
  });

  it("does not replace the old grant if saving a new OAuth grant fails", async () => {
    const authorizationId = randomUUID();
    const { auth, store, controls } = await setup({
      ...credential(),
      authorizationId,
    });
    controls.failWrite = true;
    expect((await authorize(auth)).status).toBe(400);
    expect((await store.read(alias))?.authorizationId).toBe(authorizationId);
    expect(await auth.sessionScope(alias)).toBe(authorizationId);
  });

  it("keeps credentials and the private grant identity out of authentication tool results", async () => {
    const initial = { ...credential(), authorizationId: randomUUID() };
    const { auth, writes } = await setup(initial);
    const service = createLinearService({ auth });
    const result = JSON.stringify(
      await service.call("linear_auth_status", { connectionId: alias }),
    );
    expect(result).not.toContain(initial.authorizationId);
    expect(result).not.toContain(initial.accessToken);
    expect(result).not.toContain(initial.refreshToken);
    expect(writes).toEqual([]);
  });

  it("leaves legacy credentials unchanged during read-only authentication checks", async () => {
    const { auth, store, writes } = await setup();
    const service = createLinearService({ auth });
    await expect(
      service.call("linear_auth_status", { connectionId: alias }),
    ).resolves.toMatchObject({ connected: true });
    expect((await store.read(alias))?.authorizationId).toBeUndefined();
    expect(writes).toEqual([]);
  });
});
