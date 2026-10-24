import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const fullPaths = new Set([
  "package-lock.json",
  ".node-version",
  ".npmrc",
  "src/server/composition.ts",
  "src/server/mcp.ts",
  "src/server/state.ts",
  "src/server/state-tools.ts",
  "src/server/write-guard.ts",
  "src/server/linear/auth.ts",
  "src/ui/host.ts",
  "src/ui/HostProvider.tsx",
  "src/ui/shared-context.ts",
  "src/ui/context-attachment.ts",
  "src/ui/useSharedAnnotations.ts",
  "src/ui/useDraftPersistence.tsx",
  "src/ui/local-drafts.ts",
  "src/ui/content-drafts.ts",
  "src/ui/session-state.ts",
]);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "engines",
  "packageManager",
  "workspaces",
  "type",
];
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

function revision(value, label) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{40}$/.test(value) ||
    /^0+$/.test(value)
  )
    throw new Error(`Invalid ${label} commit SHA.`);
  git("cat-file", "-e", `${value}^{commit}`);
  return value;
}

function readPackage(sha) {
  if (!git("ls-tree", "--name-only", sha, "--", "package.json").trim())
    return null;
  const value = JSON.parse(git("show", `${sha}:package.json`));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The package manifest must be an object.");
  return value;
}

function packageDependenciesChanged(base, head) {
  const before = readPackage(base);
  const after = readPackage(head);
  return (
    !before ||
    !after ||
    dependencyFields.some(
      (field) => !isDeepStrictEqual(before[field], after[field]),
    )
  );
}

function selectMode(name, event, head) {
  if (name === "schedule" || name === "workflow_dispatch") return "full";
  if (name === "release") {
    if (event.action !== "published")
      throw new Error("Only published release events are supported.");
    return "full";
  }
  let base;
  if (name === "pull_request") {
    base = revision(event.pull_request?.base?.sha, "pull request base");
  } else if (name === "push") {
    if (event.deleted)
      throw new Error("Deleted branch pushes are not supported.");
    if (event.before === "0".repeat(40)) return "full";
    base = revision(event.before, "push base");
  } else {
    throw new Error(`Unsupported CI event: ${name}.`);
  }
  // Include both sides of renames so moving code into docs cannot hide a deletion.
  const paths = git(
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    base,
    head,
    "--",
  )
    .split("\0")
    .filter(Boolean);
  if (
    paths.some(
      (path) => fullPaths.has(path) || path.startsWith("src/shared/"),
    ) ||
    (paths.includes("package.json") && packageDependenciesChanged(base, head))
  )
    return "full";
  return "smoke";
}

const { GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_SHA, GITHUB_OUTPUT } =
  process.env;
if (!GITHUB_EVENT_NAME || !GITHUB_EVENT_PATH || !GITHUB_OUTPUT)
  throw new Error(
    "CI scope selection requires the GitHub event and output paths.",
  );
const head = revision(GITHUB_SHA, "checked-out");
if (git("rev-parse", "HEAD").trim() !== head)
  throw new Error("The checked-out commit does not match GITHUB_SHA.");
const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf8"));
if (!event || typeof event !== "object" || Array.isArray(event))
  throw new Error("The GitHub event payload must be an object.");
const mode = selectMode(GITHUB_EVENT_NAME, event, head);
appendFileSync(GITHUB_OUTPUT, `mode=${mode}\n`);
console.log(JSON.stringify({ mode }));
