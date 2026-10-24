import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { setTimeout, clearTimeout } from "node:timers";

// Public app-server protocol only. No model turn or desktop UI is started.
const processHandle = spawn(
  "codex",
  [
    "app-server",
    "-c",
    "features.remote_plugin=false",
    "-c",
    "features.apps=false",
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  },
);
let sequence = 0;
const pending = new Map();
processHandle.stderr.on("data", () => {});
const lines = createInterface({ input: processHandle.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id == null) return;
  const complete = pending.get(message.id);
  if (complete) {
    pending.delete(message.id);
    complete(message);
  }
});
function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 25_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error)
        reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    processHandle.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
try {
  await call("initialize", {
    clientInfo: { name: "arco-plugin-validation", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  processHandle.stdin.write(
    JSON.stringify({ method: "initialized", params: {} }) + "\n",
  );
  const started = await call("thread/start", {
    cwd: process.cwd(),
    ephemeral: true,
  });
  const threadId = started.thread.id;
  const status = await call("mcpServerStatus/list", {
    threadId,
    detail: "full",
  });
  const server = status.data.find(
    (item) => item.name === "arco" || item.name.endsWith("__arco"),
  );
  assert(server, "Installed Arco server was not discovered");
  const names = Object.keys(server.tools ?? {});
  assert(names.includes("arco_open"), "Arco failed to initialize");
  assert(
    names.includes("arco_comments") && names.includes("linear_comments"),
    "Installed Arco lacks bounded comment paging",
  );
  assert(
    names.includes("arco_open_project"),
    "Installed Arco lacks the project viewer",
  );
  const failure = await call("mcpServer/tool/call", {
    threadId,
    server: server.name,
    tool: "search_mentions",
    arguments: { query: "source:github source:linear" },
  });
  assert.equal(failure.isError, true);
  assert.deepEqual(
    failure.structuredContent,
    {
      error: {
        kind: "invalid-input",
        message: "Choose one source for Issue search.",
      },
    },
    "The running server must expose the current structured error contract",
  );
  const ui = await call("mcpServer/resource/read", {
    threadId,
    server: server.name,
    uri: "ui://arco/issues",
  });
  const html = ui.contents.find((content) => typeof content.text === "string");
  assert(html, "Installed Arco UI resource is missing");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const expectedHtmlHash = hash(await readFile("dist/plugin/arco.html"));
  assert.equal(
    hash(html.text),
    expectedHtmlHash,
    "Installed HTML differs from the candidate build",
  );
  const open = await call("mcpServer/tool/call", {
    threadId,
    server: server.name,
    tool: "arco_open",
    arguments: {},
  });
  const linear = await call("mcpServer/tool/call", {
    threadId,
    server: server.name,
    tool: "linear_connection",
    arguments: { connectionId: "default" },
  });
  const project = await call("mcpServer/tool/call", {
    threadId,
    server: server.name,
    tool: "arco_open_project",
    arguments: {},
  });
  assert(!project.isError, "Installed project viewer failed");
  assert.equal(project.structuredContent?.launch?.view, "project");
  assert.equal(project.structuredContent.launch.repo, null);
  assert.equal(project.structuredContent.launch.projectName, null);
  assert.equal(project.structuredContent.launch.reason, "unavailable");
  assert.equal(
    project.structuredContent.launch.projectKey,
    createHash("sha256").update(`thread:${threadId}`).digest("hex"),
    "Manual repository choices must use this chat's opaque key",
  );
  console.log(
    JSON.stringify(
      {
        server: server.name,
        toolCount: names.length,
        openToolCompleted: !open.isError,
        personalView: open.structuredContent?.launch?.view,
        projectToolCompleted: !project.isError,
        projectLaunch: project.structuredContent?.launch,
        linearToolCompleted: !linear.isError,
        githubConnected: open.structuredContent?.connected === true,
        linearConnected: linear.structuredContent?.connected === true,
        resultKeys: Object.keys(open),
        structuredErrorContractVerified: true,
        candidateHtmlSha256: expectedHtmlHash,
        desktopRenderingVerified: false,
      },
      null,
      2,
    ),
  );
} finally {
  lines.close();
  processHandle.kill("SIGTERM");
}
