import { createHash } from "node:crypto";
import { z } from "zod";
import {
  issueRefSchema,
  type GitHubService,
  type IssueRef,
} from "../../shared/contracts";
import {
  githubOperationSchemas as schemas,
  type BulkUpdateResult,
  type GitHubOperationResult,
  type GitHubOperationToolName,
} from "../../shared/github-operations";
import {
  createGitHubTransport,
  createGitHubWriteGuard,
  GitHubError,
  parse,
  type GhRunner,
} from "./transport";
export type Input<K extends GitHubOperationToolName> = z.infer<
  (typeof schemas)[K]
>;

export const apiIssueSchema = z.object({
  id: z.number().int().positive(),
  node_id: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  html_url: z.string(),
  repository_url: z.string(),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
  milestone: z.object({ number: z.number() }).nullable().optional(),
  type: z.object({ id: z.number() }).nullable().optional(),
});

export function invalid(message: string): never {
  throw new GitHubError(message, "invalid");
}

export function childRequestId(requestId: string, suffix: string) {
  return `${createHash("sha256").update(requestId).digest("hex").slice(0, 40)}-${suffix}`;
}

export function issuePath(ref: IssueRef) {
  return `repos/${ref.repo}/issues/${ref.number}`;
}

export function createGitHubOperationContext(options: {
  service: GitHubService;
  run?: GhRunner;
}) {
  const { service } = options;
  const once = createGitHubWriteGuard<
    GitHubOperationResult | BulkUpdateResult
  >();
  let fixtureMode: Promise<boolean> | undefined;
  const transport = createGitHubTransport({
    run: options.run,
    policy: "extended",
    beforeRequest: async () => {
      if (options.run) return;
      fixtureMode ??= service
        .connection()
        .then((connection) => connection.mode === "fixture");
      if (await fixtureMode)
        throw new GitHubError(
          "This operation requires a live GitHub connection. Local fixture data is never sent to GitHub.",
          "fixture",
        );
    },
  });
  const api = transport.request;
  const graphql = transport.query;
  const mutate = transport.mutate;
  async function pages<T>(
    endpoint: string,
    schema: z.ZodType<T>,
  ): Promise<T[]> {
    return parse(
      z.array(z.array(schema)),
      await api("read", endpoint, "GET", undefined, true),
    ).flat();
  }

  async function issueRecord(raw: IssueRef) {
    const ref = issueRefSchema.parse(raw);
    const issue = parse(apiIssueSchema, await api("read", issuePath(ref)));
    if (issue.pull_request !== undefined)
      return invalid("This target is not an issue.");
    if (
      issue.number !== ref.number ||
      issue.repository_url.toLowerCase() !==
        `https://api.github.com/repos/${ref.repo}`.toLowerCase()
    )
      throw new GitHubError(
        "The issue repository or number has changed.",
        "conflict",
      );
    return issue;
  }

  async function refresh(ref: IssueRef): Promise<GitHubOperationResult> {
    try {
      return { ...ref, issue: await service.get(ref) };
    } catch {
      throw new GitHubError(
        "The change was saved, but the issue could not be refreshed. Refresh without repeating the update.",
        "refresh",
      );
    }
  }

  async function repoOwner(repo: string) {
    const response = parse(
      z.object({
        full_name: z.string(),
        owner: z.object({ login: z.string(), type: z.string() }),
      }),
      await api("read", `repos/${repo}`),
    );
    if (response.full_name.toLowerCase() !== repo.toLowerCase())
      throw new GitHubError("The repository location has changed.", "conflict");
    return response.owner;
  }
  return {
    service,
    once,
    api,
    graphql,
    mutate,
    pages,
    issueRecord,
    refresh,
    repoOwner,
  };
}
export type GitHubOperationContext = ReturnType<
  typeof createGitHubOperationContext
>;
