import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { createAppServerClient } from "./app-server-client.mjs";

// Direct MCP configuration only: this does not exercise the installed plugin loader.
// No model turns, plugin install, or saved threads.
const project = await realpath(fileURLToPath(new URL("..", import.meta.url)));
const production = process.argv.includes("--production");
const temporary = await mkdtemp(join(tmpdir(), "arco-project-context-"));
const nonRepository = join(temporary, "empty");
const codexHome = join(temporary, "codex-home");
await Promise.all([mkdir(nonRepository), mkdir(codexHome)]);
const bundled =
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex";
const executable =
  process.platform === "darwin"
    ? await access(bundled).then(
        () => bundled,
        () => "codex",
      )
    : "codex";
const probeServer = join(temporary, "server.mjs");
await writeFile(
  probeServer,
  `import { McpServer } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
const server = new McpServer({ name: "arco-context-probe", version: "0.0.1" });
server.registerTool("context_probe", { inputSchema: {}, annotations: { readOnlyHint: true } }, async (_args, extra) => {
  let rootCount = null;
  try { rootCount = (await server.server.listRoots(undefined, { timeout: 3000 })).roots.length; } catch { /* Unsupported hosts remain explicit. */ }
  const facts = {
    cwd: process.cwd(),
    hasThreadId: typeof extra._meta?.threadId === "string" && extra._meta.threadId.length > 0,
    rootsAdvertised: server.server.getClientCapabilities()?.roots !== undefined,
    rootCount,
  };
  return { content: [{ type: "text", text: JSON.stringify(facts) }], structuredContent: facts };
});
await server.connect(new StdioServerTransport());
`,
);

const args = [
  "app-server",
  "-c",
  "features.remote_plugin=false",
  "-c",
  "features.apps=false",
  "-c",
  `mcp_servers.arco_context_probe.command=${JSON.stringify(process.execPath)}`,
  "-c",
  `mcp_servers.arco_context_probe.args=${JSON.stringify([probeServer])}`,
];
if (production) {
  const server = join(project, "dist/plugin/server.mjs");
  await access(server).catch(() => {
    throw new Error("Build Arco before using --production.");
  });
  args.push(
    "-c",
    `mcp_servers.arco_viewer_probe.command=${JSON.stringify(process.execPath)}`,
    "-c",
    `mcp_servers.arco_viewer_probe.args=${JSON.stringify([server])}`,
    "-c",
    `mcp_servers.arco_viewer_probe.env.ARCO_DATA_DIR=${JSON.stringify(join(temporary, "arco-state"))}`,
  );
}
const child = spawn(executable, args, {
  cwd: project,
  env: { ...process.env, CODEX_HOME: codexHome },
  detached: process.platform !== "win32",
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.on("data", () => {});
const protocol = createAppServerClient(child);
function readTool(threadId, server, tool) {
  return protocol
    .call("mcpServer/tool/call", {
      threadId,
      server,
      tool,
      arguments: {},
    })
    .then((result) => {
      assert(!result.isError, `${tool} failed`);
      assert(result.structuredContent, `${tool} returned no structured result`);
      return result.structuredContent;
    });
}
const safeRepositories = (values) =>
  (values ?? []).filter(
    (value) =>
      typeof value === "string" &&
      /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value),
  );
try {
  const initialized = await protocol.call("initialize", {
    clientInfo: { name: "arco-context-probe", version: "0.0.1" },
    capabilities: { experimentalApi: true },
  });
  protocol.notify("initialized", {});
  const scenarios = [];
  const projectKeys = [];
  for (const [name, cwd] of [
    ["project", project],
    ["non-repository", nonRepository],
  ]) {
    const started = await protocol.call("thread/start", {
      cwd,
      ephemeral: true,
    });
    const status = await protocol.call("mcpServerStatus/list", {
      threadId: started.thread.id,
      detail: "full",
    });
    assert(status.data.some((item) => item.name === "arco_context_probe"));
    const facts = await readTool(
      started.thread.id,
      "arco_context_probe",
      "context_probe",
    );
    const cwdMatches = (await realpath(facts.cwd)) === (await realpath(cwd));
    assert(cwdMatches, `${name}: stdio cwd does not match the thread`);
    assert(facts.hasThreadId, `${name}: tool metadata has no thread ID`);
    const scenario = {
      name,
      stdioCwdMatchesThread: cwdMatches,
      hasThreadId: facts.hasThreadId,
      rootsAdvertised: facts.rootsAdvertised,
      rootCount: facts.rootCount,
    };
    if (production) {
      const personal = await readTool(
        started.thread.id,
        "arco_viewer_probe",
        "arco_open",
      );
      const projectView = await readTool(
        started.thread.id,
        "arco_viewer_probe",
        "arco_open_project",
      );
      assert.equal(personal.launch?.view, "personal");
      assert.equal(personal.launch.repo, null);
      assert.equal(personal.launch.projectKey, null);
      assert.equal(projectView.launch?.view, "project");
      const launch = projectView.launch;
      projectKeys.push(launch.projectKey);
      assert(
        [
          "detected",
          "unavailable",
          "ambiguous",
          "no-github-repository",
        ].includes(launch.reason),
        "Project viewer returned an unknown resolution reason",
      );
      scenario.viewers = {
        personalIgnoresProject: true,
        projectReason: launch.reason,
        projectKeyPresent: typeof launch.projectKey === "string",
        repo: safeRepositories([launch.repo])[0] ?? null,
        candidates: safeRepositories(launch.candidates),
      };
      if (facts.rootCount === 0) {
        assert.equal(launch.reason, "unavailable");
        assert.equal(launch.repo, null);
        assert.equal(typeof launch.projectKey, "string");
      }
      if (name === "non-repository") assert.equal(launch.repo, null);
    }
    scenarios.push(scenario);
  }
  if (production) assert.notEqual(projectKeys[0], projectKeys[1]);
  console.log(
    JSON.stringify(
      {
        codexVersion:
          /Codex Desktop\/([^ ]+)/.exec(initialized.userAgent)?.[1] ??
          "unknown",
        bundledCodex: executable === bundled,
        isolatedCodexHome: true,
        registeredServerBuild: production,
        pluginLoaderVerified: false,
        distinctThreadScopes: production ? true : null,
        scenarios,
        desktopRenderingVerified: false,
      },
      null,
      2,
    ),
  );
} finally {
  protocol.close();
  const stop = (signal) => {
    try {
      if (process.platform === "win32") {
        child.kill(signal);
        return;
      }
      if (child.pid) process.kill(-child.pid, signal);
    } catch {
      // The isolated process group may already have exited.
    }
  };
  stop("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      stop("SIGKILL");
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  stop("SIGKILL");
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
