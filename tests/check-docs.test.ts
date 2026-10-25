import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../scripts/check-docs.mjs", import.meta.url),
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function repository(files: Record<string, string>, formatted = true) {
  const directory = await mkdtemp(join(tmpdir(), "arco-docs-check-"));
  temporary.push(directory);
  const root = join(directory, "repository");
  await mkdir(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      formatted && file.endsWith(".md")
        ? await format(content, { parser: "markdown" })
        : content,
    );
  }
  execFileSync("git", ["add", "--all"], { cwd: root });
  return root;
}
function run(root: string) {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

describe("documentation CI checks", () => {
  it("checks links, images, references, encoded paths and local fragments", async () => {
    const root = await repository({
      "README.md":
        "# Docs\n\n[Target](docs/target.md#heading)\n\n[Encoded](assets/a%20b.txt?raw=1#section)\n\n![Image](assets/image.png)\n\n[Reference][target]\n\n[target]: docs/target.md\n",
      "docs/target.md": "# Target\n",
      "assets/a b.txt": "text",
      "assets/image.png": "image",
    });
    expect(run(root)).toEqual({
      status: 0,
      output: "PASS 2 Markdown files and 4 local links\n",
    });
  });

  it("does not interpret code examples, external URLs, or same-page anchors as local files", async () => {
    const root = await repository({
      "README.md":
        "# Docs\n\n[External](https://does-not-resolve.invalid/missing)\n\n[Anchor](#section)\n\n[Remote](//does-not-resolve.invalid/image.png)\n\n`[Example](missing.md)`\n\n```md\n[Example](missing.md)\n```\n",
    });
    expect(run(root)).toEqual({
      status: 0,
      output: "PASS 1 Markdown files and 0 local links\n",
    });
  });

  it("rejects a missing target", async () => {
    const result = run(
      await repository({ "README.md": "[Missing](missing.md)\n" }),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("missing local target");
  });

  it("rejects malformed local URL encoding", async () => {
    const result = run(
      await repository({ "README.md": "[Invalid](%zz.md)\n" }),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("invalid link encoding");
  });

  it.each(["../outside.md", "/outside.md", "%2e%2e/outside.md"])(
    "rejects a repository-escaping target: %s",
    async (url) => {
      const result = run(
        await repository({ "README.md": `[Outside](${url})\n` }),
      );
      expect(result.status).toBe(1);
      expect(result.output).toContain("outside the repository");
    },
  );

  it("rejects a symlink target that leaves the repository", async () => {
    const root = await repository({ "README.md": "[Outside](outside.txt)\n" });
    await writeFile(join(root, "../outside.txt"), "Outside the repository");
    await symlink("../outside.txt", join(root, "outside.txt"));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain("outside the repository");
  });

  it("fails formatting without rewriting the document", async () => {
    const original = "# Heading\n\n* item\n";
    const root = await repository({ "README.md": original }, false);
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain("not formatted with Prettier");
    expect(await readFile(join(root, "README.md"), "utf8")).toBe(original);
  });

  it("ignores untracked development artifacts", async () => {
    const root = await repository({ "README.md": "# Docs\n" });
    await writeFile(join(root, "untracked.md"), "[Missing](absent.md)\n");
    expect(run(root)).toEqual({
      status: 0,
      output: "PASS 1 Markdown files and 0 local links\n",
    });
  });

  it("excludes unreferenced Markdown deleted from the working tree before staging", async () => {
    const root = await repository({
      "README.md": "# Docs\n",
      "obsolete.md": "# Obsolete\n",
    });
    await rm(join(root, "obsolete.md"));
    expect(run(root)).toEqual({
      status: 0,
      output: "PASS 1 Markdown files and 0 local links\n",
    });
  });

  it("rejects links to a Markdown target deleted from the working tree before staging", async () => {
    const root = await repository({
      "README.md": "[Obsolete](obsolete.md)\n",
      "obsolete.md": "# Obsolete\n",
    });
    await rm(join(root, "obsolete.md"));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain("missing local target");
    expect(result.output).toContain("obsolete.md");
  });
});
