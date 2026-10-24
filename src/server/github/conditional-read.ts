import { Buffer } from "node:buffer";
import { apiIssueSummarySchema } from "./issue-model";
import { GitHubError, parse, type GhRunner } from "./transport";

const maxEntries = 32;
const maxBytes = 8 * 1024 * 1024;

type CacheEntry = { etag: string; json: string; bytes: number };

function response(raw: unknown) {
  if (typeof raw !== "string")
    throw new GitHubError("Unable to read the response from GitHub.");
  const separator = /\r?\n\r?\n/.exec(raw);
  if (!separator)
    throw new GitHubError("Unable to read the response from GitHub.");
  const lines = raw.slice(0, separator.index).split(/\r?\n/);
  const status = /^HTTP\/\d+(?:\.\d+)? (\d{3})(?: .*)?$/.exec(
    lines.shift() ?? "",
  );
  if (!status || !["200", "304"].includes(status[1]))
    throw new GitHubError("GitHub returned an unexpected response status.");
  let etag: string | undefined;
  for (const line of lines) {
    const header = /^([^:\s]+):[ \t]*(.*)$/.exec(line);
    if (!header)
      throw new GitHubError("Unable to read the response from GitHub.");
    if (header[1].toLowerCase() !== "etag") continue;
    if (etag !== undefined)
      throw new GitHubError("GitHub returned conflicting response validators.");
    etag = header[2].trim();
  }
  // Only validated header values may become an If-None-Match argument.
  if (etag && !/^(?:W\/)?"[\x21\x23-\x7e]{0,1024}"$/.test(etag))
    etag = undefined;
  return {
    status: Number(status[1]),
    etag,
    body: raw.slice(separator.index + separator[0].length),
  };
}

/** Memory-only conditional reads for the native account issue list. */
export function createConditionalReader(options: {
  run: GhRunner;
  beforeRequest?: () => Promise<void>;
}) {
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<string>>();
  let size = 0;
  let generation = 0;
  let scope: string | undefined;

  function clear() {
    cache.clear();
    pending.clear();
    size = 0;
    generation++;
    scope = undefined;
  }

  function remove(key: string) {
    const entry = cache.get(key);
    if (entry) size -= entry.bytes;
    cache.delete(key);
  }

  function remember(key: string, entry: CacheEntry) {
    remove(key);
    if (entry.bytes > maxBytes) return;
    cache.set(key, entry);
    size += entry.bytes;
    while (cache.size > maxEntries || size > maxBytes)
      remove(cache.keys().next().value!);
  }

  async function read(
    endpoint: string,
    projection: string,
    scopeIdentity: string,
  ): Promise<unknown> {
    // Detail, comment, and image reads must never enter this cache.
    if (!endpoint.startsWith("issues?"))
      throw new GitHubError("Conditional reads require an account issue list.");
    if (!scopeIdentity) {
      clear();
      throw new GitHubError("Unable to verify the GitHub session.", "auth");
    }
    if (scope !== scopeIdentity) {
      clear();
      scope = scopeIdentity;
    }
    const key = JSON.stringify([endpoint, projection]);
    let request = pending.get(key);
    if (!request) {
      const requestGeneration = generation;
      const entry = cache.get(key);
      if (entry) {
        cache.delete(key);
        cache.set(key, entry);
      }
      request = (async () => {
        try {
          await options.beforeRequest?.();
          if (generation !== requestGeneration)
            throw new GitHubError(
              "The GitHub session changed. Refresh the list.",
            );
          const args = [
            "api",
            "--hostname",
            "github.com",
            endpoint,
            "--method",
            "GET",
            "--header",
            "Accept: application/vnd.github+json",
            "--include",
            "--jq",
            projection,
          ];
          if (entry) args.push("--header", `If-None-Match: ${entry.etag}`);
          const result = response(await options.run(args));
          if (generation !== requestGeneration)
            throw new GitHubError(
              "The GitHub session changed. Refresh the list.",
            );
          if (result.status === 304) {
            if (!entry || result.body.trim())
              throw new GitHubError(
                "GitHub returned an unusable cached response.",
              );
            return entry.json;
          }
          let value: unknown;
          try {
            value = JSON.parse(result.body);
          } catch {
            throw new GitHubError("Unable to read the response from GitHub.");
          }
          const summaries = parse(apiIssueSummarySchema.array(), value).map(
            (issue) => ({
              ...issue,
              ...(issue.pull_request !== undefined ? { pull_request: {} } : {}),
            }),
          );
          const json = JSON.stringify(summaries);
          remove(key);
          if (result.etag)
            remember(key, {
              etag: result.etag,
              json,
              bytes: Buffer.byteLength(key) + Buffer.byteLength(json),
            });
          return json;
        } catch (error) {
          // Permission, network, and format failures never serve stale results.
          if (generation === requestGeneration) remove(key);
          throw error instanceof GitHubError
            ? error
            : new GitHubError("Unable to reach GitHub.");
        }
      })();
      pending.set(key, request);
    }
    try {
      // Callers cannot mutate summaries retained for a later 304 response.
      return JSON.parse(await request);
    } finally {
      if (pending.get(key) === request) pending.delete(key);
    }
  }

  return { read, clear };
}
