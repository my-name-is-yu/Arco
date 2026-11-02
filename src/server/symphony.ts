import { z } from "zod";
import { OperationError } from "../shared/errors";
import {
  symphonyConnectionSchema,
  symphonyBaseUrlSchema,
  symphonyRuntimeKey,
  symphonyToolSchemas,
  type SymphonyConnection,
  type SymphonyIssueResult,
  type SymphonyRuntimeRow,
  type SymphonyRuntimeStatus,
  type SymphonyService,
  type SymphonySnapshot,
} from "../shared/symphony";

const text = z.string().transform((value) => value.slice(0, 4000));
const optionalText = text.nullish().transform((value) => value ?? null);
const counter = z.number().finite().nonnegative();
const tokensSchema = z.object({
  input_tokens: counter.optional().default(0),
  output_tokens: counter.optional().default(0),
  total_tokens: counter.optional().default(0),
});
const entrySchema = z.object({
  issue_id: z.string().min(1).max(200),
  issue_identifier: z.string().min(1).max(200),
  issue_url: optionalText,
  state: optionalText,
  session_id: optionalText,
  worker_host: optionalText,
  workspace_path: optionalText,
  started_at: optionalText,
  last_event_at: optionalText,
  last_event: optionalText,
  last_message: optionalText,
  turn_count: counter.int().nullish(),
  tokens: tokensSchema.nullish(),
  attempt: counter.int().nullish(),
  due_at: optionalText,
  blocked_at: optionalText,
  error: optionalText,
});
const stateSchema = z.object({
  generated_at: z.iso.datetime({ offset: true }),
  running: z.array(entrySchema),
  retrying: z.array(entrySchema),
  blocked: z.array(entrySchema).optional().default([]),
  codex_totals: tokensSchema.extend({
    seconds_running: counter.optional().default(0),
  }),
  rate_limits: z.unknown().optional(),
});
const issueSchema = z.object({
  issue_id: z.string().min(1).max(200),
  issue_identifier: z.string().min(1).max(200),
  status: z.enum(["running", "retrying", "blocked"]),
  workspace: z.object({ path: optionalText, host: optionalText }).optional(),
  running: z.record(z.string(), z.unknown()).nullish(),
  retry: z.record(z.string(), z.unknown()).nullish(),
  blocked: z.record(z.string(), z.unknown()).nullish(),
  last_error: optionalText,
});
const errorSchema = z.object({ error: z.object({ code: z.string() }) });

export interface SymphonyServiceOptions {
  readSettings: () => Promise<{
    settings: { symphonyConnections: SymphonyConnection[] };
  }>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

function invalidResponse(): OperationError {
  return new OperationError(
    "Symphony returned an unsupported response. Check that this is the official HTTP API.",
    "invalid-response",
  );
}

function safeIssueUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function runtimeRow(
  connectionId: string,
  runtimeStatus: SymphonyRuntimeStatus,
  entry: z.infer<typeof entrySchema>,
): SymphonyRuntimeRow {
  return {
    key: symphonyRuntimeKey(connectionId, entry.issue_id),
    connectionId,
    issueId: entry.issue_id,
    issueIdentifier: entry.issue_identifier,
    issueUrl: safeIssueUrl(entry.issue_url),
    runtimeStatus,
    state: entry.state,
    sessionId: entry.session_id,
    workerHost: entry.worker_host,
    workspacePath: entry.workspace_path,
    startedAt: entry.started_at,
    lastEventAt: entry.last_event_at,
    lastEvent: entry.last_event,
    lastMessage: entry.last_message,
    turnCount: entry.turn_count ?? null,
    tokens: entry.tokens
      ? {
          inputTokens: entry.tokens.input_tokens,
          outputTokens: entry.tokens.output_tokens,
          totalTokens: entry.tokens.total_tokens,
        }
      : null,
    retryAttempt: entry.attempt ?? null,
    retryDueAt: entry.due_at,
    blockedAt: entry.blocked_at,
    error: entry.error,
  };
}

/** Keep known rate-limit measurements; do not forward arbitrary protocol payload fields. */
function rateLimits(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const keys = new Set([
    "primary",
    "secondary",
    "credits",
    "used_percent",
    "window_minutes",
    "resets_at",
    "has_credits",
    "unlimited",
    "balance",
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!keys.has(key)) continue;
    if (
      (typeof item === "number" && Number.isFinite(item)) ||
      typeof item === "boolean" ||
      item === null
    )
      result[key] = item;
    else if (
      typeof item === "string" &&
      key === "balance" &&
      /^\d+(?:\.\d+)?$/.test(item)
    )
      result[key] = item;
    else if (typeof item === "object") result[key] = rateLimits(item);
  }
  return Object.keys(result).length ? result : null;
}

export function parseSymphonyState(
  value: unknown,
  connectionId: string,
  fetchedAt = new Date().toISOString(),
): SymphonySnapshot {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  const state = parsed.data;
  const seen = new Set<string>();
  const rows = [
    ...state.running.map((entry) => runtimeRow(connectionId, "running", entry)),
    ...state.retrying.map((entry) =>
      runtimeRow(connectionId, "retrying", entry),
    ),
    ...state.blocked.map((entry) => runtimeRow(connectionId, "blocked", entry)),
  ];
  for (const row of rows) {
    if (seen.has(row.key)) throw invalidResponse();
    seen.add(row.key);
  }
  return {
    connectionId,
    generatedAt: state.generated_at,
    fetchedAt,
    rows,
    totals: {
      inputTokens: state.codex_totals.input_tokens,
      outputTokens: state.codex_totals.output_tokens,
      totalTokens: state.codex_totals.total_tokens,
      secondsRunning: state.codex_totals.seconds_running,
    },
    rateLimits: rateLimits(state.rate_limits),
  };
}

function parseIssue(
  value: unknown,
  connectionId: string,
  requestedIdentifier: string,
): SymphonyIssueResult {
  const parsed = issueSchema.safeParse(value);
  if (!parsed.success || parsed.data.issue_identifier !== requestedIdentifier)
    throw invalidResponse();
  const issue = parsed.data;
  const current =
    issue.status === "running"
      ? issue.running
      : issue.status === "blocked"
        ? issue.blocked
        : issue.retry;
  if (!current) throw invalidResponse();
  const entry = entrySchema.safeParse({
    ...current,
    issue_id: issue.issue_id,
    issue_identifier: issue.issue_identifier,
    worker_host: current.worker_host ?? issue.workspace?.host,
    workspace_path: current.workspace_path ?? issue.workspace?.path,
    error: current.error ?? issue.last_error,
  });
  if (!entry.success) throw invalidResponse();
  return {
    connectionId,
    issueIdentifier: requestedIdentifier,
    found: true,
    runtime: runtimeRow(connectionId, issue.status, entry.data),
  };
}

export function createSymphonyService(
  options: SymphonyServiceOptions,
): SymphonyService {
  const request = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const pending = new Map<string, Promise<unknown>>();

  async function connection(connectionId: string): Promise<SymphonyConnection> {
    const saved = (
      await options.readSettings()
    ).settings.symphonyConnections.find((item) => item.id === connectionId);
    if (!saved)
      throw new OperationError(
        "This Symphony connection is no longer saved. Choose a connection again.",
        "not-found",
      );
    const parsed = symphonyConnectionSchema.safeParse(saved);
    if (!parsed.success)
      throw new OperationError(
        "The saved Symphony connection is invalid. Edit its settings and try again.",
        "invalid-input",
      );
    return parsed.data;
  }

  async function json(
    baseUrl: string,
    path: string,
    allowMissing = false,
  ): Promise<unknown> {
    const key = JSON.stringify([baseUrl, path]);
    const existing = pending.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new OperationError(
              "Symphony did not respond in time. Check the existing connection route and try again.",
              "timeout",
            ),
          );
        }, timeoutMs);
      });
      try {
        return await Promise.race([
          (async () => {
            const response = await request(`${baseUrl}${path}`, {
              method: "GET",
              redirect: "manual",
              credentials: "omit",
              headers: { accept: "application/json" },
              signal: controller.signal,
            });
            if (response.status >= 300 && response.status < 400)
              throw new OperationError(
                "Symphony redirected this request. Use an API URL reachable through your existing connection route.",
                "auth",
              );
            if (response.status === 401 || response.status === 403)
              throw new OperationError(
                "The existing connection route did not allow access to Symphony. Check access outside Arco and try again.",
                response.status === 401 ? "auth" : "forbidden",
              );
            if (response.status === 429)
              throw new OperationError(
                "The Symphony connection is rate limited. Wait before refreshing.",
                "rate-limited",
              );
            if (response.status >= 500)
              throw new OperationError(
                "The Symphony runtime is unavailable. Try again after checking the service.",
                "unavailable",
              );
            const contentType = response.headers.get("content-type") ?? "";
            if (
              !/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType)
            )
              throw invalidResponse();
            const size = Number(response.headers.get("content-length"));
            if (Number.isFinite(size) && size > maxBodyBytes) {
              await response.body?.cancel();
              throw invalidResponse();
            }
            const reader = response.body?.getReader();
            if (!reader) throw invalidResponse();
            const decoder = new TextDecoder();
            let length = 0;
            let body = "";
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                length += chunk.value.byteLength;
                if (length > maxBodyBytes) {
                  await reader.cancel();
                  throw invalidResponse();
                }
                body += decoder.decode(chunk.value, { stream: true });
              }
              body += decoder.decode();
            } finally {
              reader.releaseLock();
            }
            let value: unknown;
            try {
              value = JSON.parse(body);
            } catch {
              throw invalidResponse();
            }
            const error = errorSchema.safeParse(value);
            if (
              response.status === 404 &&
              allowMissing &&
              error.success &&
              error.data.error.code === "issue_not_found"
            )
              return null;
            if (!response.ok) throw invalidResponse();
            if (error.success) {
              if (error.data.error.code === "snapshot_timeout")
                throw new OperationError(
                  "Symphony could not produce a runtime snapshot in time. Try refreshing again.",
                  "timeout",
                );
              throw new OperationError(
                "The Symphony runtime snapshot is unavailable. Try refreshing again.",
                "unavailable",
              );
            }
            return value;
          })(),
          expired,
        ]);
      } catch (error) {
        if (error instanceof OperationError) throw error;
        throw new OperationError(
          "Could not reach Symphony through the existing connection route. Check the URL and service.",
          "unavailable",
        );
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controller.abort();
      }
    })();
    pending.set(key, operation);
    try {
      return await operation;
    } finally {
      if (pending.get(key) === operation) pending.delete(key);
    }
  }

  return {
    async getState(input) {
      const { connectionId } =
        symphonyToolSchemas.arco_symphony_state.parse(input);
      const saved = await connection(connectionId);
      return parseSymphonyState(
        await json(saved.baseUrl, "/api/v1/state"),
        connectionId,
      );
    },
    async getIssue(input) {
      const { connectionId, issueIdentifier } =
        symphonyToolSchemas.arco_symphony_issue.parse(input);
      const saved = await connection(connectionId);
      const value = await json(
        saved.baseUrl,
        `/api/v1/${encodeURIComponent(issueIdentifier)}`,
        true,
      );
      return value === null
        ? { connectionId, issueIdentifier, found: false, runtime: null }
        : parseIssue(value, connectionId, issueIdentifier);
    },
    async probe(input) {
      const baseUrl = symphonyBaseUrlSchema.parse(input.baseUrl);
      return parseSymphonyState(await json(baseUrl, "/api/v1/state"), "probe");
    },
  };
}
