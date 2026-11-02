import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    server: { type: "string", default: "dist/plugin/server.mjs" },
    "expect-empty": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(
    "Usage: npm run test:symphony:live -- --url <base-url> [--expect-empty] [--server <production-server.mjs>]\nReads a running Symphony HTTP extension through direct HTTP and an isolated production Arco MCP. Does not start agents or change tracker records.",
  );
} else {
  assert(values.url, "Pass --url for a running Symphony HTTP extension.");
  const endpoint = new URL(values.url);
  assert(
    !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash &&
      (endpoint.protocol === "https:" ||
        (endpoint.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))),
    "Use a loopback HTTP or remote HTTPS base URL without credentials, query, or fragment.",
  );
  const baseUrl = endpoint.toString().replace(/\/+$/, "");
  const checks = [];
  const request = async (path) => {
    const response = await globalThis.fetch(`${baseUrl}${path}`, {
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(20_000),
      headers: { Accept: path === "/" ? "text/html" : "application/json" },
    });
    assert(
      Number(response.headers.get("content-length") ?? 0) <= 2_000_000,
      "The Symphony response is too large for this smoke check.",
    );
    const text = await response.text();
    assert(text.length <= 2_000_000, "The Symphony response is too large.");
    return { response, text };
  };

  const state = await request("/api/v1/state");
  assert.equal(state.response.status, 200, "Symphony state request failed.");
  const snapshot = JSON.parse(state.text);
  assert(!snapshot.error, "Symphony could not produce a runtime snapshot.");
  assert(Number.isFinite(Date.parse(snapshot.generated_at)));
  const statuses = ["running", "retrying", "blocked"];
  for (const status of statuses) {
    assert(Array.isArray(snapshot[status]), `Missing ${status} runtime array.`);
    assert.equal(snapshot.counts[status], snapshot[status].length);
    if (values["expect-empty"]) assert.equal(snapshot[status].length, 0);
  }
  checks.push("direct HTTP state snapshot and runtime counts");

  const missingIdentifier = "ARCO-COMPATIBILITY-NONEXISTENT";
  const missing = await request(`/api/v1/${missingIdentifier}`);
  assert.equal(missing.response.status, 404);
  assert.equal(JSON.parse(missing.text).error.code, "issue_not_found");
  checks.push("direct HTTP missing runtime is a 404, not a tracker deletion");

  const dashboard = await request("/");
  assert.equal(dashboard.response.status, 200);
  assert.match(dashboard.text, /<!doctype html>/i);
  assert.match(dashboard.text, /Symphony/i);
  checks.push("official dashboard HTML is reachable");

  const directory = await mkdtemp(join(tmpdir(), "arco-symphony-validation-"));
  const client = new Client({
    name: "Arco explicit Symphony compatibility validation",
    version: "1",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(values.server)],
    env: { ...process.env, ARCO_DATA_DIR: directory },
    stderr: "pipe",
  });
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    assert(
      !result.isError,
      result.structuredContent?.error?.message ?? `${name} failed.`,
    );
    assert(result.structuredContent, `${name} did not return structured data.`);
    return result.structuredContent;
  }
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    for (const name of [
      "arco_symphony_state",
      "arco_symphony_issue",
      "arco_symphony_test_connection",
    ]) {
      assert(
        tools.some((tool) => tool.name === name),
        `Missing ${name}.`,
      );
    }
    const settings = await call("arco_get_settings");
    const connectionId = "compatibility-validation";
    await call("arco_update_settings", {
      expectedRevision: settings.revision,
      patch: {
        activeSource: "symphony",
        symphonyConnections: [
          { id: connectionId, name: "Compatibility validation", baseUrl },
        ],
      },
    });
    checks.push(
      "isolated local connection settings saved through production MCP",
    );

    const opened = await call("arco_open", { source: "symphony" });
    assert.equal(opened.launch.source, "symphony");
    const adapted = await call("arco_symphony_state", { connectionId });
    assert.equal(adapted.connectionId, connectionId);
    assert(Number.isFinite(Date.parse(adapted.generatedAt)));
    assert(Number.isFinite(Date.parse(adapted.fetchedAt)));
    assert(Array.isArray(adapted.rows));
    for (const row of adapted.rows) {
      assert.equal(row.connectionId, connectionId);
      assert(statuses.includes(row.runtimeStatus));
    }
    if (values["expect-empty"]) assert.equal(adapted.rows.length, 0);
    checks.push("production MCP opens Symphony and parses the real state API");

    const probe = await call("arco_symphony_test_connection", { baseUrl });
    assert(Array.isArray(probe.rows));
    if (values["expect-empty"]) assert.equal(probe.rows.length, 0);
    const absent = await call("arco_symphony_issue", {
      connectionId,
      issueIdentifier: missingIdentifier,
    });
    assert.equal(absent.found, false);
    assert.equal(absent.runtime, null);
    checks.push(
      "connection probe and missing-runtime semantics through production MCP",
    );
  } finally {
    try {
      await client.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  console.log(
    JSON.stringify(
      {
        checks,
        expectedEmpty: values["expect-empty"],
        counts: snapshot.counts,
        limitations:
          "HTTP/MCP compatibility only; populated runs, native Codex rendering, provider writes, and remote routing require separate evidence.",
      },
      null,
      2,
    ),
  );
}
