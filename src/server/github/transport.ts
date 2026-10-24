import { spawn } from "node:child_process";
import { z } from "zod";
import { createWriteGuard } from "../write-guard";

export type GhRunner = (args: string[], input?: string) => Promise<unknown>;

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly code = "unavailable",
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

function commandError(stderr: string): GitHubError {
  if (/HTTP 401|not logged|authentication|gh auth login/i.test(stderr)) {
    return new GitHubError(
      "Unable to connect to GitHub. Check gh auth login in your terminal.",
      "auth",
    );
  }
  if (
    /HTTP 403|insufficient|required scopes|read:project|Resource not accessible/i.test(
      stderr,
    )
  ) {
    return new GitHubError(
      "Permission denied. Check the target and your GitHub CLI permissions.",
      "forbidden",
    );
  }
  if (/HTTP 404/i.test(stderr))
    return new GitHubError(
      "The target was not found, or you do not have permission to view it.",
      "not-found",
    );
  return new GitHubError(
    "Unable to reach GitHub. Check your connection and refresh.",
  );
}

export const runGh: GhRunner = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
    let stdout = "";
    let stderr = "";
    let exceeded = false;
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 8 * 1024 * 1024) {
        exceeded = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code === "ENOENT"
          ? new GitHubError(
              "GitHub CLI was not found. Install gh using the instructions at cli.github.com.",
              "missing-cli",
            )
          : new GitHubError("Unable to start GitHub CLI."),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || exceeded) {
        reject(commandError(stderr));
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : null);
      } catch {
        reject(new GitHubError("Unable to read the response from GitHub."));
      }
    });
    // A closed stdin must never become an uncaught process error.
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new GitHubError("GitHub returned an unexpected response format.");
  return result.data;
}

export function createGitHubWriteGuard<T>() {
  return createWriteGuard<T>(
    256,
    (message, code) => new GitHubError(message, code),
  );
}

type Access = "read" | "write";
// Preserve the two existing API contracts. A version migration is separate from transport reuse.
export const githubApiPolicies = {
  core: { version: undefined },
  extended: { version: "2026-03-10" },
} as const;

export function createGitHubTransport(options: {
  run?: GhRunner;
  policy: keyof typeof githubApiPolicies;
  beforeRequest?: () => Promise<void>;
}) {
  const run = options.run ?? runGh;
  const extended = options.policy === "extended";
  async function request(
    access: Access,
    endpoint: string,
    method = "GET",
    body?: unknown,
    paginate = false,
  ): Promise<unknown> {
    await options.beforeRequest?.();
    const args = [
      "api",
      "--hostname",
      "github.com",
      endpoint,
      "--method",
      method,
      "--header",
      "Accept: application/vnd.github+json",
    ];
    const version = githubApiPolicies[options.policy].version;
    if (version) args.push("--header", `X-GitHub-Api-Version: ${version}`);
    if (paginate) args.push("--paginate", "--slurp");
    if (body !== undefined) args.push("--input", "-");
    let value: unknown;
    try {
      value = await run(
        args,
        body === undefined ? undefined : JSON.stringify(body),
      );
    } catch (error) {
      if (access === "write")
        throw new GitHubError(
          extended
            ? "Unable to confirm the update. Check GitHub and refresh before retrying."
            : "Unable to confirm the GitHub update. Check GitHub and refresh before retrying.",
          "uncertain",
        );
      throw error instanceof GitHubError
        ? error
        : new GitHubError(
            extended
              ? "Unable to load information from GitHub."
              : "Unable to reach GitHub.",
          );
    }
    if (value && typeof value === "object" && "errors" in value)
      throw new GitHubError(
        extended
          ? "Unable to verify the GitHub Projects permissions, target, or response."
          : access === "write"
            ? "Unable to confirm the Projects update. Refresh to check the result."
            : "Unable to load Projects. Check the read:project permission in GitHub CLI.",
        access === "write" ? "uncertain" : "forbidden",
      );
    return value;
  }
  async function query(query: string, variables: Record<string, unknown>) {
    try {
      return await request("read", "graphql", "POST", { query, variables });
    } catch (error) {
      if (
        extended &&
        error instanceof GitHubError &&
        error.code === "forbidden"
      )
        throw new GitHubError(
          "Unable to load Projects. Check read:project in GitHub CLI and your access to the target.",
          "forbidden",
        );
      throw error;
    }
  }
  const mutate = (query: string, variables: Record<string, unknown>) =>
    request("write", "graphql", "POST", { query, variables });
  return { request, query, mutate };
}

export type GitHubTransport = ReturnType<typeof createGitHubTransport>;
