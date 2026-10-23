import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { repoSchema } from "../shared/contracts";
import type { LaunchContext } from "../shared/launch";

const execute = promisify(execFile);

export function conversationLaunchKey(threadId: unknown): string | null {
  if (
    typeof threadId !== "string" ||
    threadId.length === 0 ||
    threadId.length > 512
  )
    return null;
  return createHash("sha256").update(`thread:${threadId}`).digest("hex");
}

export function githubRepositoryFromRemote(remote: string): string | null {
  let path: string;
  const scp = /^(?:[^@\s/:]+@)?github\.com:([^\s]+)$/i.exec(remote);
  if (scp) path = scp[1];
  else {
    try {
      const url = new URL(remote);
      if (
        !["https:", "http:", "ssh:", "git:"].includes(url.protocol) ||
        url.hostname.toLowerCase() !== "github.com" ||
        url.search ||
        url.hash
      )
        return null;
      path = url.pathname.replace(/^\//, "");
    } catch {
      return null;
    }
  }
  const parsed = repoSchema.safeParse(
    path.replace(/\/$/, "").replace(/\.git$/i, ""),
  );
  return parsed.success ? parsed.data : null;
}

async function readGitRemotes(directory: string): Promise<string[]> {
  try {
    const { stdout } = await execute(
      "git",
      [
        "-C",
        directory,
        "config",
        "--local",
        "--null",
        "--get-regexp",
        "^remote\\..*\\.url$",
      ],
      {
        timeout: 5000,
        maxBuffer: 256 * 1024,
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
      },
    );
    return stdout
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(entry.indexOf("\n") + 1));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (
        error.code === 1 &&
        "stdout" in error &&
        error.stdout === "" &&
        "stderr" in error &&
        error.stderr === ""
      )
        return [];
      if (
        error.code === 128 &&
        "stderr" in error &&
        typeof error.stderr === "string" &&
        error.stderr.trim() ===
          "fatal: --local can only be used inside a git repository"
      )
        return [];
    }
    // Never propagate subprocess errors: they can contain credential-bearing URLs.
    // eslint-disable-next-line preserve-caught-error -- The cause could expose Git credentials.
    throw new Error("Git remotes could not be read.");
  }
}

export interface ProjectLaunchOptions {
  listRoots?: () => Promise<readonly { uri: string }[]>;
  /** An explicitly supplied workspace directory, never the MCP process cwd. */
  workingDirectory?: string;
  readRemotes?: (directory: string) => Promise<string[]>;
}

export async function resolveProjectLaunch({
  listRoots,
  workingDirectory,
  readRemotes = readGitRemotes,
}: ProjectLaunchOptions): Promise<LaunchContext> {
  const unresolved: LaunchContext = {
    view: "project",
    repo: null,
    projectKey: null,
    projectName: null,
    candidates: [],
    reason: "unavailable",
  };
  let directories: string[] = [];
  if (listRoots) {
    try {
      const roots = await listRoots();
      if (roots.length > 32) return unresolved;
      directories = roots.flatMap(({ uri }) => {
        try {
          const url = new URL(uri);
          return url.protocol === "file:" ? [fileURLToPath(url)] : [];
        } catch {
          return [];
        }
      });
      // Advertised non-file roots cannot be replaced with an unrelated cwd.
      if (directories.length !== roots.length) return unresolved;
    } catch {
      return unresolved;
    }
  }
  if (
    directories.length === 0 &&
    workingDirectory &&
    isAbsolute(workingDirectory)
  )
    directories = [workingDirectory];
  const canonical = await Promise.all(
    directories.map(async (directory) => {
      try {
        const path = await realpath(directory);
        return (await stat(path)).isDirectory() ? path : null;
      } catch {
        return null;
      }
    }),
  );
  const roots = [
    ...new Set(canonical.filter((path): path is string => path !== null)),
  ].sort();
  if (roots.length === 0 || canonical.some((path) => path === null))
    return unresolved;
  const project = {
    ...unresolved,
    projectKey: createHash("sha256").update(roots.join("\0")).digest("hex"),
    projectName:
      roots.length === 1
        ? basename(roots[0]).slice(0, 256) || "Project"
        : `${roots.length} folders`,
  };
  const remoteResults = await Promise.allSettled(
    roots.map((root) => readRemotes(root)),
  );
  if (remoteResults.some((result) => result.status === "rejected"))
    return project;
  const remotes = remoteResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const repositories = new Map<string, string>();
  for (const remote of remotes) {
    const repo = githubRepositoryFromRemote(remote);
    if (repo) repositories.set(repo.toLowerCase(), repo);
  }
  const candidates = [...repositories.values()].sort();
  return {
    ...project,
    candidates: candidates.slice(0, 100),
    repo: candidates.length === 1 ? candidates[0] : null,
    reason:
      candidates.length === 1
        ? "detected"
        : candidates.length > 1
          ? "ambiguous"
          : "no-github-repository",
  };
}
