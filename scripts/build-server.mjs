import { build } from "esbuild";
import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

await rm("dist/npm", { recursive: true, force: true });
const project = JSON.parse(await readFile("package.json", "utf8"));
const source = JSON.parse(
  await readFile(".agents/plugins/marketplace.json", "utf8"),
).plugins.find((plugin) => plugin.name === "arco").source;
assert.equal(source.source, "npm");
assert.equal(
  source.version,
  project.version,
  "marketplace version must match package.json",
);
for (const path of ["plugin/plugin.json", "plugin/.codex-plugin/plugin.json"]) {
  assert.equal(
    JSON.parse(await readFile(path, "utf8")).version,
    project.version,
    `${path} version must match package.json`,
  );
}

await rm("dist/plugin", { recursive: true, force: true });
await mkdir("dist/plugin", { recursive: true });
const options = {
  entryPoints: ["src/server/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  minifySyntax: true,
  loader: { ".svg": "text" },
  external: ["@napi-rs/keyring"],
  banner: {
    js: "import { Module } from 'node:module'; const require = Module.createRequire(import.meta.url);",
  },
};
await build({
  ...options,
  outfile: "dist/plugin/server.mjs",
  define: { __ARCO_FIXTURE__: "false" },
});
await build({
  ...options,
  outfile: "dist/dev/server.mjs",
  define: { __ARCO_FIXTURE__: "true" },
});
await cp("plugin", "dist/plugin", { recursive: true });
await cp("LICENSE", "dist/plugin/LICENSE");
await cp("dist/ui/index.html", "dist/plugin/arco.html");
await cp("dist/ui/index.html", "dist/dev/arco.html");
// Native credential storage is the only runtime package kept outside the bundle.
// Include the installed OS/arch binary; no install hook or network fetch on use.
const keyring = JSON.parse(
  await readFile("node_modules/@napi-rs/keyring/package.json", "utf8"),
);
const runtimePackages = ["@napi-rs/keyring"];
for (const name of Object.keys(keyring.optionalDependencies ?? {})) {
  try {
    await readFile(join("node_modules", name, "package.json"));
    runtimePackages.push(name);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    /* Other OS/arch packages are not installed here. */
  }
}
for (const name of runtimePackages)
  await cp(join("node_modules", name), join("dist/plugin/node_modules", name), {
    recursive: true,
  });
const dependencies = Object.fromEntries(
  await Promise.all(
    runtimePackages.map(async (name) => [
      name,
      JSON.parse(
        await readFile(
          join("dist/plugin/node_modules", name, "package.json"),
          "utf8",
        ),
      ).version,
    ]),
  ),
);
await writeFile(
  "dist/plugin/package.json",
  JSON.stringify(
    {
      name: source.package,
      version: project.version,
      description: "GitHub and Linear issue client for Codex.",
      type: "module",
      license: project.license,
      repository: project.repository,
      homepage: "https://github.com/my-name-is-yu/Arco#readme",
      engines: project.engines,
      os: [process.platform],
      cpu: [process.arch],
      files: [
        "plugin.json",
        ".codex-plugin/",
        "mcp.json",
        ".mcp.json",
        "server.mjs",
        "arco.html",
        "skills/",
        "assets/",
        "runtime-platform.json",
        "THIRD_PARTY_NOTICES.txt",
      ],
      dependencies,
      bundleDependencies: runtimePackages,
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org/",
      },
    },
    null,
    2,
  ) + "\n",
);
await mkdir("dist/.agents/plugins", { recursive: true });
await writeFile(
  "dist/.agents/plugins/marketplace.json",
  JSON.stringify(
    {
      name: "arco-local",
      plugins: [
        {
          name: "arco",
          source: { source: "local", path: "./plugin" },
          policy: { installation: "AVAILABLE", authentication: "ON_USE" },
          category: "Productivity",
        },
      ],
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "dist/plugin/runtime-platform.json",
  JSON.stringify(
    { platform: process.platform, arch: process.arch, runtimePackages },
    null,
    2,
  ),
);
const paths = execFileSync(
  "npm",
  ["ls", "--omit=dev", "--all", "--parseable"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .slice(1);
const notices = [];
for (const path of [...new Set(paths)]) {
  const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
  const licenses = await Promise.all(
    (await readdir(path))
      .filter((name) => /^(license|copying|notice)(\.|$)/i.test(name))
      .map((name) => readFile(join(path, name), "utf8")),
  );
  notices.push(
    `${pkg.name}@${pkg.version} (${pkg.license ?? "See package metadata"})\n${licenses.join("\n")}`,
  );
}
await writeFile(
  "dist/plugin/THIRD_PARTY_NOTICES.txt",
  notices.join("\n\n--------------------\n\n"),
);
