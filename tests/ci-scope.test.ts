import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/ci-scope.mjs");
const roots: string[] = [];
const manifest = {
  name: "ci-scope-fixture",
  type: "module",
  engines: { node: ">=24.22.1 <25" },
  dependencies: { example: "1.0.0" },
  scripts: { test: "echo fixture" },
};

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), "arco-ci-scope-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Arco fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  const write = (path: string, value: string) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, value);
  };
  const commit = () => {
    git("add", "-A");
    git("commit", "--quiet", "--no-gpg-sign", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  git("init", "--quiet", "--initial-branch=main");
  write("package.json", JSON.stringify(manifest));
  write("package-lock.json", "{}");
  write("README.md", "# Fixture\n");
  write("docs/guide.md", "# Guide\n");
  write("src/ui/View.tsx", "export const view = 1;\n");
  write("src/ui/host.ts", "export const host = 1;\n");
  const base = commit();
  const run = (name: string, event: object, sha = git("rev-parse", "HEAD")) => {
    const eventFile = join(root, "event.json");
    const outputFile = join(root, "output.txt");
    writeFileSync(eventFile, JSON.stringify(event));
    writeFileSync(outputFile, "");
    const output = execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: name,
        GITHUB_EVENT_PATH: eventFile,
        GITHUB_SHA: sha,
        GITHUB_OUTPUT: outputFile,
      },
    });
    const result = JSON.parse(output) as { mode: string };
    expect(readFileSync(outputFile, "utf8")).toBe(`mode=${result.mode}\n`);
    return result.mode;
  };
  return { root, git, write, commit, base, run };
}

describe("CI validation scope", () => {
  it("keeps plugin skill Markdown on the code path", () => {
    const repo = repository();
    repo.write("plugin/skills/setup/SKILL.md", "# Shipped skill\n");
    repo.commit();
    expect(repo.run("push", { before: repo.base })).toBe("smoke");
  });

  it("runs code checks for mixed code and documentation changes", () => {
    const repo = repository();
    repo.write("README.md", "# Updated\n");
    repo.write("src/ui/View.tsx", "export const view = 2;\n");
    repo.commit();
    expect(
      repo.run("pull_request", { pull_request: { base: { sha: repo.base } } }),
    ).toBe("smoke");
  });

  it("includes both sides when code is renamed into documentation", () => {
    const repo = repository();
    repo.git("mv", "src/ui/View.tsx", "docs/example.md");
    repo.commit();
    expect(repo.run("push", { before: repo.base })).toBe("smoke");
  });

  it("includes deleted host code when it is renamed into documentation", () => {
    const repo = repository();
    repo.git("mv", "src/ui/host.ts", "docs/host.md");
    repo.commit();
    expect(repo.run("push", { before: repo.base })).toBe("full");
  });

  it.each([
    "package-lock.json",
    ".node-version",
    "src/ui/host.ts",
    "src/server/state.ts",
    "src/shared/contracts.ts",
  ])("requires full E2E for %s", (path) => {
    const repo = repository();
    repo.write(path, "changed\n");
    repo.commit();
    expect(repo.run("push", { before: repo.base })).toBe("full");
  });

  it("does not treat package script changes as dependency changes", () => {
    const repo = repository();
    repo.write(
      "package.json",
      JSON.stringify({ ...manifest, scripts: { test: "echo updated" } }),
    );
    repo.commit();
    expect(repo.run("push", { before: repo.base })).toBe("smoke");
  });

  it.each([
    { dependencies: { example: "2.0.0" } },
    { devDependencies: { development: "1.0.0" } },
    { engines: { node: ">=25" } },
    { overrides: { example: "2.0.0" } },
  ])("requires full E2E when dependency/runtime fields change: %j", (patch) => {
    const repo = repository();
    repo.write("package.json", JSON.stringify({ ...manifest, ...patch }));
    repo.commit();
    expect(repo.run("push", { before: repo.base })).toBe("full");
  });

  it("requires full E2E when the package manifest is deleted", () => {
    const repo = repository();
    rmSync(join(repo.root, "package.json"));
    repo.commit();
    expect(repo.run("push", { before: repo.base })).toBe("full");
  });

  it("requires full E2E for an initial push", () => {
    const repo = repository();
    expect(repo.run("push", { before: "0".repeat(40) })).toBe("full");
  });

  it.each(["schedule", "workflow_dispatch"])("runs full E2E for %s", (name) => {
    const repo = repository();
    expect(repo.run(name, {})).toBe("full");
  });

  it("runs full E2E after release publication", () => {
    const repo = repository();
    expect(repo.run("release", { action: "published" })).toBe("full");
  });

  it.each([
    ["push", {}],
    ["push", { before: "--help" }],
    ["push", { before: "f".repeat(40) }],
    ["push", { before: "0".repeat(40), deleted: true }],
    ["pull_request", {}],
    ["release", { action: "prereleased" }],
    ["unknown", {}],
  ])("rejects missing or invalid event context for %s %j", (name, event) => {
    const repo = repository();
    expect(() => repo.run(name as string, event as object)).toThrow();
  });

  it("rejects a checkout that differs from GITHUB_SHA", () => {
    const repo = repository();
    repo.write("README.md", "# Updated\n");
    repo.commit();
    expect(() => repo.run("push", { before: repo.base }, repo.base)).toThrow(
      /checked-out commit/,
    );
  });

  it("rejects an invalid package manifest instead of reducing validation", () => {
    const repo = repository();
    repo.write("package.json", "invalid JSON");
    repo.commit();
    expect(() => repo.run("push", { before: repo.base })).toThrow();
  });
});
