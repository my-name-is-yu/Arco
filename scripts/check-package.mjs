import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const output = resolve("dist/npm");
const temporary = await mkdtemp(join(tmpdir(), "arco-package-"));
try {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const [packed] = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--offline",
        "--json",
        "--cache",
        join(temporary, "npm-cache"),
        "--pack-destination",
        temporary,
      ],
      { cwd: resolve("dist/plugin"), encoding: "utf8" },
    ),
  );
  const archive = join(temporary, packed.filename);
  execFileSync("tar", ["-xzf", archive, "-C", temporary]);
  const directory = join(temporary, "package");
  const metadata = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  );
  const project = JSON.parse(await readFile("package.json", "utf8"));
  const source = JSON.parse(
    await readFile(".agents/plugins/marketplace.json", "utf8"),
  ).plugins.find((plugin) => plugin.name === "arco").source;
  assert.equal(metadata.name, source.package);
  assert.equal(metadata.version, project.version);
  assert.equal(source.version, metadata.version);
  assert.equal(metadata.private, undefined);
  assert.equal(
    metadata.scripts,
    undefined,
    "package must work without lifecycle scripts",
  );
  assert.deepEqual(metadata.os, [process.platform]);
  assert.deepEqual(metadata.cpu, [process.arch]);
  assert.deepEqual(metadata.engines, project.engines);
  const runtime = JSON.parse(
    await readFile(join(directory, "runtime-platform.json"), "utf8"),
  );
  assert.equal(runtime.platform, process.platform);
  assert.equal(runtime.arch, process.arch);
  assert.deepEqual(metadata.bundleDependencies, runtime.runtimePackages);
  for (const name of metadata.bundleDependencies) {
    const dependency = JSON.parse(
      await readFile(
        join(directory, "node_modules", name, "package.json"),
        "utf8",
      ),
    );
    assert.equal(dependency.version, metadata.dependencies[name]);
    if (name !== "@napi-rs/keyring")
      assert(
        packed.files.some(
          (file) =>
            file.path.startsWith(`node_modules/${name}/`) &&
            file.path.endsWith(".node"),
        ),
        `${name} native binary missing from tarball`,
      );
  }
  assert(
    metadata.bundleDependencies.length > 1,
    "native keyring package missing",
  );
  [
    "plugin.json",
    ".codex-plugin/plugin.json",
    "mcp.json",
    ".mcp.json",
    "assets/icon.svg",
    "assets/icon-dark.svg",
    "THIRD_PARTY_NOTICES.txt",
    "skills/arco-setup/SKILL.md",
    "skills/arco-issue-workflow/SKILL.md",
  ].forEach((file) =>
    assert(
      packed.files.some((entry) => entry.path === file),
      `${file} missing from tarball`,
    ),
  );
  const manifest = JSON.parse(
    await readFile(join(directory, "plugin.json"), "utf8"),
  );
  const compatibility = JSON.parse(
    await readFile(join(directory, ".codex-plugin/plugin.json"), "utf8"),
  );
  for (const plugin of [manifest, compatibility]) {
    assert.equal(plugin.version, metadata.version);
    await readFile(
      join(directory, plugin.extensions["com.openai"].onboardingSkill),
    );
  }
  const config = JSON.parse(
    await readFile(join(directory, "mcp.json"), "utf8"),
  );
  const legacyConfig = JSON.parse(
    await readFile(join(directory, ".mcp.json"), "utf8"),
  );
  const server = config.mcpServers.arco;
  assert.equal(server.type, "stdio");
  assert.equal(server.command, "node");
  assert.equal(legacyConfig.mcpServers.arco.command, server.command);
  assert.deepEqual(server.args, ["${PLUGIN_ROOT}/server.mjs"]);
  assert.deepEqual(legacyConfig.mcpServers.arco.args, server.args);
  execFileSync(process.execPath, ["scripts/check-artifact.mjs", directory], {
    stdio: "inherit",
  });

  // The extracted production server must resolve everything without the checkout.
  // Only MCP discovery/resource reads run; no provider or credential-store calls.
  const env = { ...process.env, ARCO_DATA_DIR: join(temporary, "state") };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  // Lazy credential loading must not weaken native verification of the tarball.
  // Resolve and load the extracted binding explicitly, without constructing entries.
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import assert from "node:assert/strict";
       import { fileURLToPath } from "node:url";
       import { join, sep } from "node:path";
       assert(fileURLToPath(import.meta.resolve("@napi-rs/keyring"))
         .startsWith(join(process.cwd(), "node_modules") + sep));
       const { AsyncEntry } = await import("@napi-rs/keyring");
       assert.equal(typeof AsyncEntry, "function");`,
    ],
    { cwd: directory, env, stdio: "pipe" },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: server.args.map((argument) =>
      argument.replaceAll("${PLUGIN_ROOT}", directory),
    ),
    cwd: temporary,
    env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const client = new Client({ name: "Arco packed-plugin check", version: "1" });
  try {
    await client.connect(transport);
    const listing = await client.listTools();
    ["arco_open", "arco_show_issue", "arco_update_issue"].forEach((name) =>
      assert(
        listing.tools.some((tool) => tool.name === name),
        `${name} missing from packaged server`,
      ),
    );
    const html = await client.readResource({ uri: "ui://arco/issues" });
    assert.equal(
      html.contents[0].text,
      await readFile(join(directory, "arco.html"), "utf8"),
    );
  } finally {
    await client.close();
  }
  assert.equal(stderr, "", "packaged production server wrote to stderr");
  const destination = join(output, packed.filename);
  await copyFile(archive, `${destination}.tmp`);
  await rename(`${destination}.tmp`, destination);
  console.log(
    `PASS extracted production plugin, native keyring loading, MCP tools and UI; ${packed.filename} (${packed.size} bytes, ${packed.unpackedSize} unpacked)`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
