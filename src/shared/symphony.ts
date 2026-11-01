import { z } from "zod";
import { repoSchema } from "./contracts";

const id = z.string().trim().min(1).max(200);
const labels = z.array(z.string().trim().min(1).max(100)).max(100);
const stateIds = z.array(id).max(100);

/** Symphony's HTTP extension has no application authentication of its own. */
export function normalizeSymphonyUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error(
      "Use a local HTTP or remote HTTPS URL without credentials, query, or fragment.",
    );
  return url.toString().replace(/\/+$/, "");
}

export const symphonyBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((value, context) => {
    try {
      return normalizeSymphonyUrl(value);
    } catch {
      context.addIssue({
        code: "custom",
        message:
          "Use a local HTTP or remote HTTPS URL without credentials, query, or fragment.",
      });
      return z.NEVER;
    }
  });

export const symphonyBindingSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("github"),
      repo: repoSchema,
      prepareLabels: labels,
      reviewLabels: labels,
    })
    .strict(),
  z
    .object({
      source: z.literal("linear"),
      connectionId: id,
      workspaceId: id,
      teamId: id,
      projectId: id.optional(),
      prepareStateIds: stateIds,
      reviewStateIds: stateIds,
    })
    .strict(),
]);

export const symphonyConnectionSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(100),
    baseUrl: symphonyBaseUrlSchema,
    binding: symphonyBindingSchema.optional(),
  })
  .strict();

export type SymphonyConnection = z.infer<typeof symphonyConnectionSchema>;
export type SymphonyBinding = z.infer<typeof symphonyBindingSchema>;
export type SymphonySelection = {
  connectionId: string;
  issueIdentifier?: string;
};
export type SymphonyRuntimeStatus = "running" | "retrying" | "blocked";
export type SymphonyTokens = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export interface SymphonyRuntimeRow {
  key: string;
  connectionId: string;
  issueId: string;
  issueIdentifier: string;
  issueUrl: string | null;
  runtimeStatus: SymphonyRuntimeStatus;
  state: string | null;
  sessionId: string | null;
  workerHost: string | null;
  workspacePath: string | null;
  startedAt: string | null;
  lastEventAt: string | null;
  lastEvent: string | null;
  lastMessage: string | null;
  turnCount: number | null;
  tokens: SymphonyTokens | null;
  retryAttempt: number | null;
  retryDueAt: string | null;
  blockedAt: string | null;
  error: string | null;
}

export interface SymphonySnapshot {
  connectionId: string;
  generatedAt: string;
  fetchedAt: string;
  rows: SymphonyRuntimeRow[];
  totals: SymphonyTokens & { secondsRunning: number };
  rateLimits: unknown;
}

export interface SymphonyIssueResult {
  connectionId: string;
  issueIdentifier: string;
  found: boolean;
  runtime: SymphonyRuntimeRow | null;
}

export const symphonyRuntimeContextSchema = z
  .object({
    connectionId: id,
    connectionName: z.string().min(1).max(100),
    issueIdentifier: id,
    observedAt: z.string().min(1).max(100),
    runtimeStatus: z.enum(["running", "retrying", "blocked"]),
    lastEvent: z.string().max(200).nullable(),
    lastMessage: z.string().max(4000).nullable(),
    error: z.string().max(4000).nullable(),
    turnCount: z.number().int().nonnegative().nullable(),
    retryDueAt: z.string().max(100).nullable(),
    issue: z
      .object({
        source: z.enum(["github", "linear"]),
        url: z
          .url()
          .max(2048)
          .refine((value) => {
            try {
              const url = new URL(value);
              return (
                url.protocol === "https:" &&
                !url.username &&
                !url.password &&
                !url.search &&
                !url.hash &&
                issueUrl(value) !== null
              );
            } catch {
              return false;
            }
          }),
        title: z.string().min(1).max(256),
        identifier: id,
      })
      .strict()
      .refine(
        (issue) =>
          issueUrl(issue.url)?.startsWith(
            issue.source === "github" ? "github.com/" : "linear.app/",
          ) ?? false,
      )
      .optional(),
  })
  .strict();
/** Explicit sharing excludes server URLs, worker hosts, paths, and raw rate-limit payloads. */
export type SymphonyRuntimeContext = z.infer<
  typeof symphonyRuntimeContextSchema
>;

export function symphonyRuntimeContext(
  connection: SymphonyConnection,
  row: SymphonyRuntimeRow,
  observedAt: string,
  issue?: SymphonyRuntimeContext["issue"],
): SymphonyRuntimeContext {
  return {
    connectionId: connection.id,
    connectionName: connection.name,
    issueIdentifier: row.issueIdentifier,
    observedAt,
    runtimeStatus: row.runtimeStatus,
    lastEvent: row.lastEvent?.slice(0, 200) ?? null,
    lastMessage: row.lastMessage,
    error: row.error,
    turnCount: row.turnCount,
    retryDueAt: row.retryDueAt,
    ...(issue ? { issue } : {}),
  };
}

export const symphonyToolSchemas = {
  arco_symphony_state: z.object({ connectionId: id }).strict(),
  arco_symphony_issue: z
    .object({ connectionId: id, issueIdentifier: id })
    .strict(),
  arco_symphony_test_connection: z
    .object({ baseUrl: symphonyBaseUrlSchema })
    .strict(),
};

export interface SymphonyService {
  getState(input: { connectionId: string }): Promise<SymphonySnapshot>;
  getIssue(input: {
    connectionId: string;
    issueIdentifier: string;
  }): Promise<SymphonyIssueResult>;
  probe(input: { baseUrl: string }): Promise<SymphonySnapshot>;
}

export type SymphonyNativeIssue =
  | { source?: "github"; repo: string; number: number; url: string }
  | {
      source: "linear";
      connectionId: string;
      workspaceId: string;
      teamId: string;
      issueId: string;
      url: string;
      project?: { id: string } | null;
    };

function issueUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    const path = url.pathname.replace(/\/+$/, "");
    if (url.hostname.toLowerCase() === "github.com")
      return /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*$/.test(path)
        ? `github.com${path.toLowerCase()}`
        : null;
    if (url.hostname.toLowerCase() === "linear.app") {
      const match = path.match(/^\/([^/]+)\/issue\/([^/]+)/i);
      return match
        ? `linear.app/${match[1].toLowerCase()}/issue/${match[2].toLowerCase()}`
        : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Native scope is required before comparing any runtime dispatch identifier. */
export function symphonyIssueMatches(
  binding: SymphonyBinding | undefined,
  row: SymphonyRuntimeRow,
  issue: SymphonyNativeIssue,
): boolean {
  if (!binding) return false;
  if (binding.source === "github") {
    if (
      !("repo" in issue) ||
      binding.repo.toLowerCase() !== issue.repo.toLowerCase()
    )
      return false;
    const expected = `github.com/${binding.repo.toLowerCase()}/issues/${issue.number}`;
    if (row.issueUrl)
      return (
        issueUrl(row.issueUrl) === expected && issueUrl(issue.url) === expected
      );
    return (
      row.issueId === String(issue.number) &&
      row.issueIdentifier === `GH-${issue.number}`
    );
  }
  if (
    !("issueId" in issue) ||
    issue.connectionId !== binding.connectionId ||
    issue.workspaceId !== binding.workspaceId ||
    issue.teamId !== binding.teamId ||
    (binding.projectId && issue.project?.id !== binding.projectId)
  )
    return false;
  if (row.issueUrl) {
    const native = issueUrl(issue.url);
    return native !== null && issueUrl(row.issueUrl) === native;
  }
  return row.issueId === issue.issueId;
}

export function symphonyRuntimeKey(
  connectionId: string,
  issueId: string,
): string {
  return JSON.stringify([connectionId, issueId]);
}
