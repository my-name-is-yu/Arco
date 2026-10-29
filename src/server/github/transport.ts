import { spawn } from "node:child_process";
import { z } from "zod";
import { createWriteGuard, getWriteProgress, trackWrite } from "../write-guard";
import { OperationError } from "../../shared/errors";

export type GhRunner = (args: string[], input?: string) => Promise<unknown>;

export class GitHubError extends OperationError {
  constructor(
    message: string,
    readonly code = "unavailable",
  ) {
    super(message, code);
    this.name = "GitHubError";
  }
}

export function isGitHubWriteOutcomeError(error: unknown) {
  return (
    error instanceof GitHubError &&
    ["refresh", "partial", "not-applied", "uncertain"].includes(error.code)
  );
}

export function commandError(stderr: string): GitHubError {
  if (/HTTP 429|(?:secondary |API )?rate limit|abuse detection/i.test(stderr))
    return new GitHubError(
      "GitHub is temporarily limiting requests. Wait and refresh.",
      "rate-limited",
    );
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
      "The target was not found, or you cannot view it. Check its GitHub link and your access.",
      "not-found",
    );
  if (/HTTP 409/i.test(stderr))
    return new GitHubError(
      "The GitHub target changed while this operation was in progress. Refresh before trying again.",
      "conflict",
    );
  if (/HTTP 400|HTTP 422/i.test(stderr))
    return new GitHubError(
      "GitHub rejected the supplied values. Check the selected target and fields.",
      "invalid-input",
    );
  if (/HTTP 408|HTTP 504|timed? ?out|deadline exceeded/i.test(stderr))
    return new GitHubError(
      "GitHub took too long to respond. Check your connection and refresh.",
      "timeout",
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
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    let exceeded = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30_000);
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
      if (timedOut) {
        reject(new GitHubError("The GitHub request timed out.", "timeout"));
        return;
      }
      if (exceeded) {
        reject(
          new GitHubError(
            "The GitHub response exceeded the supported size.",
            "invalid-response",
          ),
        );
        return;
      }
      const included = args[0] === "api" && args.includes("--include");
      const separator = /\r?\n\r?\n/.exec(stdout);
      const emptyNotModified =
        included &&
        args.includes("GET") &&
        /^HTTP\/\S+ 304(?:\s|$)/.test(stdout) &&
        separator !== null &&
        stdout.slice(separator.index + separator[0].length).trim() === "" &&
        stderr.trim() === "unexpected end of JSON input";
      // gh's --jq attempts to parse the empty 304 body and exits 1. The HTTP
      // status and empty body are still authoritative for this explicit read.
      if (code !== 0 && !emptyNotModified) {
        // gh exits nonzero for GraphQL errors even when a mutation returned
        // partial data. Preserve it so the transport can avoid replaying a
        // potentially applied write based only on the stderr error category.
        if (args[0] === "api" && args[3] === "graphql") {
          try {
            const value: unknown = JSON.parse(stdout);
            if (
              value &&
              typeof value === "object" &&
              "errors" in value &&
              "data" in value &&
              value.data != null
            ) {
              resolve(value);
              return;
            }
          } catch {
            // The normal CLI failure below remains authoritative otherwise.
          }
        }
        reject(commandError(stderr));
        return;
      }
      try {
        resolve(included ? stdout : stdout.trim() ? JSON.parse(stdout) : null);
      } catch {
        reject(
          new GitHubError(
            "Unable to read the response from GitHub.",
            "invalid-response",
          ),
        );
      }
    });
    // A closed stdin must never become an uncaught process error.
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new GitHubError(
      "Could not read the GitHub response. Refresh and try again.",
      "invalid-response",
    );
  return result.data;
}

export function createGitHubWriteGuard<T>(readScope: () => Promise<string>) {
  const once = createWriteGuard<T>(
    256,
    (message, code) => new GitHubError(message, code),
    readScope,
  );
  return (requestId: string, payload: unknown, write: () => Promise<T>) =>
    once(requestId, payload, async () => {
      try {
        return await write();
      } catch (error) {
        const progress = getWriteProgress();
        if (
          (!progress.confirmed && !progress.uncertain) ||
          isGitHubWriteOutcomeError(error)
        )
          throw error;
        throw new GitHubError(
          progress.uncertain
            ? "Unable to confirm all GitHub changes. Check GitHub and refresh before retrying."
            : "The change was saved to GitHub, but its result could not be verified. Check GitHub and refresh without repeating the update.",
          progress.uncertain ? "uncertain" : "refresh",
        );
      }
    });
}

function rejectedWrite(error: unknown) {
  return (
    error instanceof GitHubError &&
    [
      "auth",
      "missing-cli",
      "forbidden",
      "not-found",
      "rate-limited",
      "conflict",
      "invalid-input",
    ].includes(error.code)
  );
}

type Access = "read" | "write";
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
  async function send(
    access: Access,
    endpoint: string,
    method = "GET",
    body?: unknown,
    paginate = false,
    projection?: string,
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
    if (projection !== undefined) args.push("--jq", projection);
    if (body !== undefined) args.push("--input", "-");
    const execute = async () => {
      const value = await run(
        args,
        body === undefined ? undefined : JSON.stringify(body),
      );
      if (value && typeof value === "object" && "errors" in value) {
        const errors = (value as { errors: unknown }).errors;
        const types = Array.isArray(errors)
          ? errors.map((error: unknown) =>
              error && typeof error === "object" && "type" in error
                ? error.type
                : null,
            )
          : [];
        const hasPartialData = "data" in value && value.data != null;
        if (
          (!hasPartialData || access === "read") &&
          types.length &&
          types.every((type) => type === "RATE_LIMITED")
        )
          throw new GitHubError(
            "GitHub is temporarily limiting requests. Wait and refresh.",
            "rate-limited",
          );
        throw new GitHubError(
          access === "write"
            ? "Unable to confirm the Projects update. Check GitHub and refresh before retrying."
            : extended
              ? "Could not verify access to this GitHub Project. Check your Project permissions and refresh."
              : "Could not load Projects. Check your GitHub Projects permissions and refresh.",
          access === "write" ? "uncertain" : "forbidden",
        );
      }
      return value;
    };
    try {
      return await (access === "write"
        ? trackWrite(execute, rejectedWrite)
        : execute());
    } catch (error) {
      if (access === "write" && !rejectedWrite(error))
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
              ? "Unable to load information from GitHub. Check your connection and refresh."
              : "Unable to reach GitHub. Check your connection and refresh.",
          );
    }
  }
  const request = (
    access: Access,
    endpoint: string,
    method = "GET",
    body?: unknown,
    paginate = false,
  ) => send(access, endpoint, method, body, paginate);
  const read = (endpoint: string, projection: string) =>
    send("read", endpoint, "GET", undefined, false, projection);
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
  return { request, read, query, mutate };
}

export type GitHubTransport = ReturnType<typeof createGitHubTransport>;
