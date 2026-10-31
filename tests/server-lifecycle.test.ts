import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { build } from "esbuild";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "arco-server-lifecycle-"));
  const options = {
    entryPoints: ["src/server/index.ts"],
    bundle: true,
    platform: "node" as const,
    format: "esm" as const,
    external: ["@napi-rs/keyring"],
    loader: { ".svg": "text" as const },
    define: { __ARCO_FIXTURE__: "false" },
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  };
  await build({ ...options, outfile: join(directory, "production.mjs") });
  await build({
    ...options,
    outfile: join(directory, "held-writes.mjs"),
    plugins: [
      {
        name: "local-lifecycle-backend",
        setup(builder) {
          builder.onLoad({ filter: /src\/server\/composition\.ts$/ }, () => ({
            loader: "ts",
            resolveDir: process.cwd(),
            contents: `
              import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
              import { join } from 'node:path';
              import { createFixtureService } from './src/server/fixture';
              import { createFixtureGitHubOperations } from './src/server/github-operations-fixture';
              import { createLinearFixtureService } from './src/server/linear/fixture';
              import { createStateStore } from './src/server/state';
              export function createLiveBackend() {
                const root = process.env.ARCO_DATA_DIR;
                const fixture = process.env.ARCO_LIFECYCLE_FIXTURE === 'true';
                const record = event => appendFileSync(join(root, 'events'), event + '\\n');
                const gate = new Promise(resolve => process.on('message', message => {
                  if (message === 'release') resolve();
                }));
                const service = createFixtureService();
                const comment = service.comment.bind(service);
                service.comment = async input => {
                  record('provider-start');
                  await gate;
                  const result = await comment(input);
                  writeFileSync(join(root, 'provider.json'), JSON.stringify(result));
                  return result;
                };
                const stateStore = createStateStore(join(root, 'state'));
                const update = stateStore.updateSettings.bind(stateStore);
                stateStore.updateSettings = async input => {
                  record('storage-start');
                  await gate;
                  return update(input);
                };
                return {
                  service, stateStore, fixture,
                  linearService: createLinearFixtureService(),
                  operations: createFixtureGitHubOperations({ service }),
                  cleanup() {
                    record('cleanup');
                    if (fixture) rmSync(join(root, 'state'), { recursive: true, force: true });
                  },
                };
              }
              export const createFixtureBackend = createLiveBackend;
            `,
          }));
          builder.onLoad(
            { filter: /src\/server\/index\.ts$/ },
            async (args) => ({
              loader: "ts",
              resolveDir: resolve("src/server"),
              contents: `${await readFile(args.path, "utf8")}
              process.on('message', async message => {
                if (message === 'close') {
                  await server.close();
                  process.disconnect();
                }
              });`,
            }),
          );
        },
      },
    ],
  });
}, 15_000);
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function start(bundle: string, root: string, fixture?: boolean) {
  const options: SpawnOptions = {
    env: {
      ...process.env,
      ARCO_DATA_DIR: root,
      ARCO_LIFECYCLE_FIXTURE: String(fixture),
    },
    stdio: fixture === undefined ? "pipe" : ["pipe", "pipe", "pipe", "ipc"],
  };
  const child: ChildProcess = spawn(
    process.execPath,
    [join(directory, bundle)],
    options,
  );
  const exited = once(child, "exit");
  let stderr = "";
  let stdout = "";
  const messages = new Map<number, Record<string, unknown>>();
  child.stderr!.on("data", (chunk) => (stderr += String(chunk)));
  child.stdout!.on("data", (chunk) => {
    stdout += String(chunk);
    let newline;
    while ((newline = stdout.indexOf("\n")) !== -1) {
      const message = JSON.parse(stdout.slice(0, newline));
      stdout = stdout.slice(newline + 1);
      if (typeof message.id === "number") messages.set(message.id, message);
    }
  });
  let nextId = 1;
  const send = (message: object) =>
    child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const request = (method: string, params: object) => {
    const id = nextId++;
    send({ id, method, params });
    return id;
  };
  const reply = async (id: number) => {
    await vi.waitFor(() => expect(messages.has(id)).toBe(true));
    return messages.get(id)!;
  };
  return {
    child,
    exited,
    request,
    reply,
    async initialize() {
      const id = request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "local-lifecycle-test", version: "1" },
      });
      expect(await reply(id)).not.toHaveProperty("error");
      send({ method: "notifications/initialized" });
    },
    async finish() {
      expect(await exited).toEqual([0, null]);
      expect(stderr).toBe("");
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await exited;
      }
    },
  };
}

it("releases a live pending OAuth callback listener after stdin EOF", async () => {
  const root = await mkdtemp(join(directory, "oauth-"));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const server = start("production.mjs", root);
  try {
    await server.initialize();
    const id = server.request("tools/call", {
      name: "linear_auth_begin",
      arguments: {
        connectionId: "local-lifecycle-test",
        clientId: "fictional-local-client",
        redirectUri: `http://127.0.0.1:${port}/oauth/linear/callback`,
      },
    });
    expect(await server.reply(id)).toMatchObject({
      result: { structuredContent: { expiresIn: 300 } },
    });
    // No callback code, credential operation, or external request is involved.
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
    server.child.stdin!.end();
    await vi.waitFor(() => expect(server.child.exitCode).toBe(0));
    await server.finish();
    const replacement = createServer();
    replacement.listen(port, "127.0.0.1");
    await once(replacement, "listening");
    await new Promise<void>((done) => replacement.close(() => done()));
  } finally {
    await server.stop();
  }
});

it.each([false, true])(
  "preserves dispatched provider and storage replies after EOF (fixture=%s)",
  async (fixture) => {
    const root = await mkdtemp(join(directory, "writes-"));
    const server = start("held-writes.mjs", root, fixture);
    const events = async () =>
      (await readFile(join(root, "events"), "utf8")).trim().split("\n");
    try {
      await server.initialize();
      const comment = {
        name: "arco_comment",
        arguments: {
          repo: "yu/Arco",
          number: 42,
          body: "Accepted before EOF",
          requestId: "lifecycle-comment",
        },
      };
      const provider = server.request("tools/call", comment);
      const repeated = server.request("tools/call", comment);
      const storage = server.request("tools/call", {
        name: "arco_update_settings",
        arguments: {
          expectedRevision: 0,
          patch: { activeGithubRepo: "yu/Arco" },
        },
      });
      await vi.waitFor(async () => {
        expect(await events()).toEqual([
          "provider-start",
          "provider-start",
          "storage-start",
        ]);
      });
      server.child.stdin!.end();
      await vi.waitFor(() =>
        expect(server.child.stdin!.writableFinished).toBe(true),
      );
      if (fixture) expect(await events()).not.toContain("cleanup");
      else
        await vi.waitFor(async () =>
          expect(await events()).toContain("cleanup"),
        );
      server.child.send("release");
      const result = await server.reply(provider);
      expect(result).toMatchObject({
        result: {
          structuredContent: { postedComment: { body: "Accepted before EOF" } },
        },
      });
      expect(await server.reply(repeated)).toEqual({ ...result, id: repeated });
      expect(await server.reply(storage)).toMatchObject({
        result: {
          structuredContent: {
            revision: 1,
            settings: { activeGithubRepo: "yu/Arco" },
          },
        },
      });
      const saved = JSON.parse(
        await readFile(join(root, "state/settings.json"), "utf8"),
      );
      expect(saved).toMatchObject({
        revision: 1,
        settings: { activeGithubRepo: "yu/Arco" },
      });
      const receipt = JSON.parse(
        await readFile(join(root, "provider.json"), "utf8"),
      );
      expect(
        receipt.comments.filter(
          (entry: { body: string }) => entry.body === "Accepted before EOF",
        ),
      ).toHaveLength(1);
      server.child.send("close");
      await server.finish();
      expect(
        (await events()).filter((event) => event === "cleanup"),
      ).toHaveLength(1);
      if (fixture)
        await expect(
          readFile(join(root, "state/settings.json")),
        ).rejects.toHaveProperty("code", "ENOENT");
    } finally {
      await server.stop();
    }
  },
);
