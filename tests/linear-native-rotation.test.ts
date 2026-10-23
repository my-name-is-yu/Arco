import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { createCredentialStore } from "../src/server/linear/auth";

it("rotates an OS-stored fake credential once across independent Node processes", async (context) => {
  await mkdir("test-results", { recursive: true });
  const directory = await mkdtemp(
    join(process.cwd(), "test-results", "linear-native-rotation-"),
  );
  const connectionId = `arco-native-test-${randomUUID()}`;
  const store = createCredentialStore();
  let stored = false;
  try {
    try {
      await store.write(connectionId, {
        clientId: "fake-test-client",
        accessToken: "fake-expired-access",
        refreshToken: "fake-old-refresh",
        expiresAt: 0,
        scopes: ["read", "write"],
      });
      stored = true;
    } catch {
      context.skip(
        true,
        "OS credential storage unavailable on this execution platform; never use plaintext fallback.",
      );
      return;
    }
    const worker = join(directory, "worker.mjs");
    await build({
      stdin: {
        contents: `
      import { createLinearAuth } from './src/server/linear/auth';
      import { appendFile } from 'node:fs/promises';
      const auth = createLinearAuth({ directory: process.argv[2], fetch: async () => {
        await appendFile(process.argv[3], 'refresh\\n');
        return Response.json({ access_token: 'fake-new-access', refresh_token: 'fake-new-refresh', expires_in: 86400, scope: 'read write' });
      } });
      const token = await auth.accessToken(process.argv[4]);
      if (token !== 'fake-new-access') process.exitCode = 1;
      auth.close();
    `,
        resolveDir: process.cwd(),
        loader: "ts",
      },
      outfile: worker,
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["@napi-rs/keyring"],
      banner: {
        js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
      },
    });
    const record = join(directory, "refresh-count");
    const run = promisify(execFile);
    await Promise.all([
      run(process.execPath, [worker, directory, record, connectionId]),
      run(process.execPath, [worker, directory, record, connectionId]),
    ]);
    expect(await readFile(record, "utf8")).toBe("refresh\n");
    expect(await store.read(connectionId)).toMatchObject({
      accessToken: "fake-new-access",
      refreshToken: "fake-new-refresh",
    });
  } finally {
    if (stored) await store.remove(connectionId);
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
