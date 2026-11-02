import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const runtime = {
  generated_at: "2026-11-01T00:00:00Z",
  running: [],
  retrying: [],
  blocked: [],
  counts: { running: 0, retrying: 0, blocked: 0 },
};

const fixture = `
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const calls = [];
const snapshot = { connectionId: 'compatibility-validation', generatedAt: '2026-11-01T00:00:00Z', fetchedAt: '2026-11-01T00:00:01Z', rows: [] };
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') return reply(message.id, { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'validation-fixture', version: '1' } });
  if (message.method === 'tools/list') return reply(message.id, { tools: ['arco_symphony_state', 'arco_symphony_issue', 'arco_symphony_test_connection'].map(name => ({ name, inputSchema: { type: 'object' } })) });
  const { name, arguments: args } = message.params;
  calls.push({ name, args, directory: process.env.ARCO_DATA_DIR });
  writeFileSync(process.env.ARCO_SYMPHONY_VALIDATION_RECORD, JSON.stringify(calls));
  let result;
  if (name === 'arco_get_settings') result = { revision: 0, settings: {} };
  else if (name === 'arco_update_settings') result = { revision: 1, settings: args.patch };
  else if (name === 'arco_open') result = { launch: { source: 'symphony' } };
  else if (name === 'arco_symphony_state' || name === 'arco_symphony_test_connection') result = snapshot;
  else if (name === 'arco_symphony_issue') result = { found: false, runtime: null };
  else throw new Error('Unexpected tool ' + name);
  reply(message.id, { content: [], structuredContent: result });
});
`;

async function run(snapshot: object) {
  const directory = await mkdtemp(join(tmpdir(), "arco-symphony-script-test-"));
  directories.push(directory);
  const serverFile = join(directory, "server.mjs");
  const record = join(directory, "calls.json");
  await writeFile(serverFile, fixture);
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === "/api/v1/state") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(snapshot));
    } else if (request.url === "/api/v1/ARCO-COMPATIBILITY-NONEXISTENT") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "issue_not_found" } }));
    } else {
      response.setHeader("content-type", "text/html");
      response.end("<!DOCTYPE html><title>Symphony Observability</title>");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const script = new URL("../scripts/validate-symphony.mjs", import.meta.url);
  try {
    const result = await new Promise<{
      error: Error | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        [
          fileURLToPath(script),
          "--url",
          `http://127.0.0.1:${address.port}`,
          "--expect-empty",
          "--server",
          serverFile,
        ],
        {
          timeout: 5000,
          env: { ...process.env, ARCO_SYMPHONY_VALIDATION_RECORD: record },
        },
        (error, stdout, stderr) => resolve({ error, stdout, stderr }),
      );
    });
    const calls: {
      name: string;
      args: Record<string, unknown>;
      directory: string;
    }[] = await readFile(record, "utf8")
      .then(JSON.parse)
      .catch(() => []);
    return { ...result, calls, requests };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

it("uses only read HTTP and isolated MCP settings while validating a real endpoint", async () => {
  const result = await run(runtime);
  expect(result.error).toBeNull();
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).expectedEmpty).toBe(true);
  expect(result.requests).toEqual([
    "GET /api/v1/state",
    "GET /api/v1/ARCO-COMPATIBILITY-NONEXISTENT",
    "GET /",
  ]);
  expect(result.calls.map((call) => call.name)).toEqual([
    "arco_get_settings",
    "arco_update_settings",
    "arco_open",
    "arco_symphony_state",
    "arco_symphony_test_connection",
    "arco_symphony_issue",
  ]);
  expect(
    result.calls.every((call) =>
      call.directory.includes("arco-symphony-validation-"),
    ),
  ).toBe(true);
  await expect(stat(result.calls[0].directory)).rejects.toThrow();
});

it("rejects an HTTP 200 snapshot error before opening the MCP", async () => {
  const result = await run({
    generated_at: runtime.generated_at,
    error: { code: "snapshot_unavailable" },
  });
  expect(result.error).not.toBeNull();
  expect(result.stderr).toContain(
    "Symphony could not produce a runtime snapshot",
  );
  expect(result.calls).toEqual([]);
  expect(result.requests).toEqual(["GET /api/v1/state"]);
});
