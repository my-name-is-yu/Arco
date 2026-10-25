import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "arco-native-loading-"));
  const { build } = await import("esbuild");
  await build({
    entryPoints: ["src/server/linear/auth.ts"],
    outfile: join(directory, "auth.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["@napi-rs/keyring"],
    banner: {
      js: "import { Module } from 'node:module'; const require = Module.createRequire(import.meta.url);",
    },
  });
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function probe(operation: "roundtrip" | "read" | "write" | "remove") {
  const root = await mkdtemp(join(directory, "probe-"));
  await copyFile(join(directory, "auth.mjs"), join(root, "auth.mjs"));
  await mkdir(join(root, "node_modules/@napi-rs/keyring"), {
    recursive: true,
  });
  await writeFile(
    join(root, "node_modules/@napi-rs/keyring/package.json"),
    JSON.stringify({ type: "module", exports: "./index.mjs" }),
  );
  // An isolated external adapter records loading and never accesses an OS store.
  await writeFile(
    join(root, "node_modules/@napi-rs/keyring/index.mjs"),
    `import { writeFileSync } from 'node:fs';
    writeFileSync(process.env.ARCO_NATIVE_LOAD_MARKER, 'loaded');
    if (process.env.ARCO_NATIVE_LOAD_OPERATION !== 'roundtrip')
      throw new Error('Fictional native-loader secret');
    const values = new Map();
    export class AsyncEntry {
      constructor(service, id) { this.id = service + ':' + id; }
      async getPassword() { return values.get(this.id) ?? null; }
      async setPassword(value) { values.set(this.id, value); }
      async deleteCredential() { values.delete(this.id); }
    }`,
  );
  await writeFile(
    join(root, "probe.mjs"),
    `import { existsSync } from 'node:fs';
    const { createCredentialStore } = await import('./auth.mjs');
    const afterImport = existsSync(process.env.ARCO_NATIVE_LOAD_MARKER);
    const store = createCredentialStore();
    const afterConstruction = existsSync(process.env.ARCO_NATIVE_LOAD_MARKER);
    const credential = { clientId: 'fictional', accessToken: 'fake-access',
      refreshToken: 'fake-refresh', expiresAt: 1, scopes: ['read', 'write'] };
    if (process.env.ARCO_NATIVE_LOAD_OPERATION === 'roundtrip') {
      await store.write('fictional', credential);
      const saved = await store.read('fictional');
      await store.remove('fictional');
      const removed = await store.read('fictional');
      console.log(JSON.stringify({ afterImport, afterConstruction,
        afterOperation: existsSync(process.env.ARCO_NATIVE_LOAD_MARKER), saved, removed }));
    } else {
      try {
        const operation = process.env.ARCO_NATIVE_LOAD_OPERATION;
        await store[operation]('fictional', credential);
        throw new Error('Expected storage failure');
      } catch (error) {
        console.log(JSON.stringify({ afterImport, afterConstruction,
          afterOperation: existsSync(process.env.ARCO_NATIVE_LOAD_MARKER),
          code: error.code, message: error.message }));
      }
    }`,
  );
  const result = await promisify(execFile)(
    process.execPath,
    [join(root, "probe.mjs")],
    {
      cwd: root,
      env: {
        ...process.env,
        ARCO_NATIVE_LOAD_MARKER: join(root, "loaded"),
        ARCO_NATIVE_LOAD_OPERATION: operation,
      },
    },
  );
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as {
    afterImport: boolean;
    afterConstruction: boolean;
    afterOperation: boolean;
    saved?: unknown;
    removed?: unknown;
    code?: string;
    message?: string;
  };
}

describe("native credential adapter loading", () => {
  it("loads only for a credential operation and keeps serialization and removal", async () => {
    expect(await probe("roundtrip")).toEqual({
      afterImport: false,
      afterConstruction: false,
      afterOperation: true,
      saved: {
        clientId: "fictional",
        accessToken: "fake-access",
        refreshToken: "fake-refresh",
        expiresAt: 1,
        scopes: ["read", "write"],
      },
      removed: null,
    });
  });
  it.each(["read", "write", "remove"] as const)(
    "keeps lazy-load failures inside the %s storage boundary",
    async (operation) => {
      const result = await probe(operation);
      expect(result).toMatchObject({
        afterImport: false,
        afterConstruction: false,
        afterOperation: true,
        code: "storage",
      });
      expect(result.message).not.toContain("Fictional native-loader secret");
      expect(result.message).toContain("credential store");
    },
  );
});
