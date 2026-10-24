import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { check, resolveConfig } from "prettier";

const root = await realpath(
  execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim(),
);
const deleted = new Set(
  execFileSync(
    "git",
    ["-C", root, "ls-files", "--deleted", "-z", "--", "*.md"],
    { encoding: "utf8" },
  ).split("\0"),
);
const files = execFileSync(
  "git",
  ["-C", root, "ls-files", "-z", "--", "*.md"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter((file) => file && !deleted.has(file));
const failures = [];
let links = 0;
function insideRepository(path) {
  const fromRoot = relative(root, path);
  return (
    !isAbsolute(fromRoot) &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`)
  );
}
function urls(node) {
  return [
    ...(["link", "image", "definition"].includes(node.type) ? [node.url] : []),
    ...(node.children?.flatMap(urls) ?? []),
  ];
}
for (const file of files) {
  const path = resolve(root, file);
  if (!insideRepository(await realpath(path))) {
    failures.push(`${JSON.stringify(file)} resolves outside the repository.`);
    continue;
  }
  const content = await readFile(path, "utf8");
  const options = await resolveConfig(path, { editorconfig: true });
  if (!(await check(content, { ...options, filepath: path })))
    failures.push(`${JSON.stringify(file)} is not formatted with Prettier.`);
  for (const url of urls(fromMarkdown(content))) {
    if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//")) continue;
    const local = url.split(/[?#]/, 1)[0];
    if (!local) continue;
    links++;
    let target;
    try {
      target = resolve(dirname(path), decodeURIComponent(local));
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      failures.push(
        `${JSON.stringify(file)} has invalid link encoding: ${JSON.stringify(url)}`,
      );
      continue;
    }
    if (!insideRepository(target)) {
      failures.push(
        `${JSON.stringify(file)} links outside the repository: ${JSON.stringify(url)}`,
      );
      continue;
    }
    try {
      if (!insideRepository(await realpath(target)))
        failures.push(
          `${JSON.stringify(file)} links outside the repository: ${JSON.stringify(url)}`,
        );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      failures.push(
        `${JSON.stringify(file)} has a missing local target: ${JSON.stringify(url)}`,
      );
    }
  }
}
if (failures.length) {
  failures.forEach((failure) => console.error(failure));
  process.exitCode = 1;
} else
  console.log(`PASS ${files.length} Markdown files and ${links} local links`);
