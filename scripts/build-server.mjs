import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

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
    js: "import { createRequire as __arcoCreateRequire } from 'node:module'; const require = __arcoCreateRequire(import.meta.url);",
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
  const names = (await readdir(path)).filter((name) =>
    /^(license|copying|notice)(\.|$)/i.test(name),
  );
  const licenses = await Promise.all(
    names.map((name) => readFile(join(path, name), "utf8")),
  );
  notices.push(
    `${pkg.name}@${pkg.version} (${pkg.license ?? "See package metadata"})\n${licenses.join("\n")}`,
  );
}
await writeFile(
  "dist/plugin/THIRD_PARTY_NOTICES.txt",
  notices.join("\n\n--------------------\n\n"),
);
