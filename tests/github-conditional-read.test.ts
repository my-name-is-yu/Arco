import { describe, expect, it, vi } from "vitest";
import { createConditionalReader } from "../src/server/github/conditional-read";
import { GitHubError, type GhRunner } from "../src/server/github/transport";

const endpoint =
  "issues?filter=all&state=all&sort=updated&direction=desc&per_page=100&page=1";
const projection = "[.[] | {node_id, number, title}]";
const issue = (title = "One") => ({
  node_id: "I_1",
  number: 1,
  title,
  state: "open",
  updated_at: "2026-10-24T01:00:00Z",
  html_url: "https://github.com/owner/repo/issues/1",
  repository_url: "https://api.github.com/repos/owner/repo",
  user: { login: "owner" },
  labels: [],
  assignees: [],
});
const ok = (value: unknown = [issue()], etag: string | null = 'W/"one"') =>
  `HTTP/2.0 200 OK\nContent-Type: application/json\r\n${etag === null ? "" : `Etag: ${etag}\r\n`}\r\n${JSON.stringify(value)}\n`;
const unchanged = 'HTTP/2.0 304 Not Modified\nEtag: "one"\r\n\r\n';
const condition = (args: string[]) =>
  args.find((arg) => arg.startsWith("If-None-Match:"));

describe("conditional account issue reads", () => {
  it("revalidates the exact native list and reuses summaries only after a 304", async () => {
    const run = vi
      .fn<GhRunner>()
      .mockResolvedValueOnce(
        ok([
          { ...issue(), body: "large detail", comments: [{ body: "comment" }] },
          { ...issue("Pull request"), pull_request: { body: "PR detail" } },
        ]),
      )
      .mockResolvedValueOnce(unchanged);
    const reader = createConditionalReader({ run });
    const first = await reader.read(endpoint, projection, "credential-one");
    expect(first).toEqual([
      issue(),
      { ...issue("Pull request"), pull_request: {} },
    ]);
    first[0].title = "Caller mutation";
    expect(await reader.read(endpoint, projection, "credential-one")).toEqual([
      issue(),
      { ...issue("Pull request"), pull_request: {} },
    ]);
    expect(run.mock.calls[0][0]).toEqual([
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
    ]);
    expect(condition(run.mock.calls[1][0])).toBe('If-None-Match: W/"one"');
  });

  it("replaces changed summaries and their validator on a fresh 200", async () => {
    const run = vi
      .fn<GhRunner>()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok([issue("Updated")], '"two"'))
      .mockResolvedValueOnce(unchanged);
    const reader = createConditionalReader({ run });
    await reader.read(endpoint, projection, "credential-one");
    expect(await reader.read(endpoint, projection, "credential-one")).toEqual([
      issue("Updated"),
    ]);
    expect(await reader.read(endpoint, projection, "credential-one")).toEqual([
      issue("Updated"),
    ]);
    expect(condition(run.mock.calls[1][0])).toBe('If-None-Match: W/"one"');
    expect(condition(run.mock.calls[2][0])).toBe('If-None-Match: "two"');
  });

  it("does not retain responses without a usable ETag", async () => {
    const run = vi
      .fn<GhRunner>()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok([issue("No validator")], null))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok([issue()], "unquoted"))
      .mockResolvedValueOnce(ok());
    const reader = createConditionalReader({ run });
    for (let i = 0; i < 5; i++)
      await reader.read(endpoint, projection, "credential-one");
    expect(condition(run.mock.calls[1][0])).toBeDefined();
    expect(condition(run.mock.calls[2][0])).toBeUndefined();
    expect(condition(run.mock.calls[3][0])).toBeDefined();
    expect(condition(run.mock.calls[4][0])).toBeUndefined();
  });

  it.each(["permission", "network", "json", "schema"])(
    "rejects a %s failure and discards its prior cached response",
    async (failure) => {
      const run = vi.fn<GhRunner>().mockResolvedValueOnce(ok());
      if (failure === "permission")
        run.mockRejectedValueOnce(new GitHubError("Denied", "forbidden"));
      else if (failure === "network")
        run.mockRejectedValueOnce(new Error("Disconnected"));
      else if (failure === "json")
        run.mockResolvedValueOnce('HTTP/2.0 200 OK\nEtag: "two"\r\n\r\n{');
      else run.mockResolvedValueOnce(ok([{ title: "Missing identity" }]));
      run.mockResolvedValueOnce(ok());
      const reader = createConditionalReader({ run });
      await reader.read(endpoint, projection, "credential-one");
      await expect(
        reader.read(endpoint, projection, "credential-one"),
      ).rejects.toBeInstanceOf(GitHubError);
      await reader.read(endpoint, projection, "credential-one");
      expect(condition(run.mock.calls[2][0])).toBeUndefined();
    },
  );

  it("isolates credential rotations even for the same GitHub account", async () => {
    const run = vi.fn<GhRunner>().mockResolvedValue(ok());
    const reader = createConditionalReader({ run });
    await reader.read(endpoint, projection, "same-user-token-one");
    await reader.read(endpoint, projection, "same-user-token-two");
    await reader.read(endpoint, projection, "same-user-token-one");
    expect(run.mock.calls.map(([args]) => condition(args))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    await expect(reader.read(endpoint, projection, "")).rejects.toMatchObject({
      code: "auth",
    });
    await reader.read(endpoint, projection, "same-user-token-one");
    expect(condition(run.mock.calls[3][0])).toBeUndefined();
  });

  it("separates filters, ordering, page numbers, and projections", async () => {
    const run = vi.fn<GhRunner>().mockResolvedValue(ok());
    const reader = createConditionalReader({ run });
    for (const next of [
      endpoint,
      endpoint.replace("filter=all", "filter=assigned"),
      endpoint.replace("direction=desc", "direction=asc"),
      endpoint.replace("&page=1", "&page=2"),
    ])
      await reader.read(next, projection, "credential-one");
    await reader.read(endpoint, `${projection} `, "credential-one");
    expect(run.mock.calls.every(([args]) => !condition(args))).toBe(true);
    await reader.read(endpoint, projection, "credential-one");
    expect(condition(run.mock.calls[5][0])).toBeDefined();
  });

  it("evicts the least recently used page after 32 cached pages", async () => {
    const run = vi.fn<GhRunner>(async (args) =>
      condition(args) ? unchanged : ok(),
    );
    const reader = createConditionalReader({ run });
    const page = (number: number) =>
      endpoint.replace("&page=1", `&page=${number}`);
    for (let number = 1; number <= 32; number++)
      await reader.read(page(number), projection, "credential-one");
    await reader.read(page(1), projection, "credential-one");
    await reader.read(page(33), projection, "credential-one");
    await reader.read(page(1), projection, "credential-one");
    await reader.read(page(2), projection, "credential-one");
    expect(condition(run.mock.calls[34][0])).toBeDefined();
    expect(condition(run.mock.calls[35][0])).toBeUndefined();
  });

  it("also bounds retained summary bytes and skips oversized responses", async () => {
    const run = vi
      .fn<GhRunner>()
      .mockResolvedValue(ok([issue("x".repeat(3_000_000))]));
    const reader = createConditionalReader({ run });
    for (let number = 1; number <= 3; number++)
      await reader.read(
        endpoint.replace("&page=1", `&page=${number}`),
        projection,
        "credential-one",
      );
    await reader.read(endpoint, projection, "credential-one");
    expect(condition(run.mock.calls[3][0])).toBeUndefined();
    run.mockResolvedValue(ok([issue("x".repeat(9_000_000))]));
    const oversized = endpoint.replace("&page=1", "&page=100");
    await reader.read(oversized, projection, "credential-one");
    await reader.read(oversized, projection, "credential-one");
    expect(condition(run.mock.calls[5][0])).toBeUndefined();
  });

  it("shares a concurrent request while giving each caller its own summaries", async () => {
    let resolve!: (value: string) => void;
    const run = vi.fn<GhRunner>(
      () => new Promise<string>((done) => (resolve = done)),
    );
    const beforeRequest = vi.fn(async () => undefined);
    const reader = createConditionalReader({ run, beforeRequest });
    const first = reader.read(endpoint, projection, "credential-one");
    const second = reader.read(endpoint, projection, "credential-one");
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(beforeRequest).toHaveBeenCalledTimes(1);
    resolve(ok());
    const [one, two] = await Promise.all([first, second]);
    expect(one).toEqual(two);
    expect(one).not.toBe(two);
  });

  it("clearing during a request prevents its response from restoring old data", async () => {
    let resolve!: (value: string) => void;
    const run = vi
      .fn<GhRunner>()
      .mockImplementationOnce(
        () => new Promise<string>((done) => (resolve = done)),
      )
      .mockResolvedValue(ok([issue("After clear")]));
    const reader = createConditionalReader({ run });
    const first = reader.read(endpoint, projection, "credential-one");
    await Promise.resolve();
    reader.clear();
    resolve(ok());
    await expect(first).rejects.toThrow("session changed");
    expect(await reader.read(endpoint, projection, "credential-one")).toEqual([
      issue("After clear"),
    ]);
    expect(condition(run.mock.calls[1][0])).toBeUndefined();
  });

  it.each([
    unchanged,
    "HTTP/2.0 200 OK\n\r\nnot-json",
    'HTTP/2.0 200 OK\nEtag: "one"\nETag: "two"\n\n[]',
    "HTTP/2.0 403 Forbidden\n\r\n[]",
    "[]",
  ])("rejects an unusable uncached response", async (value) => {
    const reader = createConditionalReader({
      run: vi.fn<GhRunner>().mockResolvedValue(value),
    });
    await expect(
      reader.read(endpoint, projection, "credential-one"),
    ).rejects.toBeInstanceOf(GitHubError);
  });

  it("does not accept a body on a 304 response", async () => {
    const run = vi
      .fn<GhRunner>()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(`${unchanged}[]`);
    const reader = createConditionalReader({ run });
    await reader.read(endpoint, projection, "credential-one");
    await expect(
      reader.read(endpoint, projection, "credential-one"),
    ).rejects.toThrow("unusable cached response");
  });

  it("keeps detail, comment, and image endpoints outside conditional reads", async () => {
    const run = vi.fn<GhRunner>();
    const reader = createConditionalReader({ run });
    for (const target of [
      "repos/owner/repo/issues/1",
      "repos/owner/repo/issues/1/comments",
      "https://github.com/user-attachments/assets/image.png",
    ])
      await expect(
        reader.read(target, projection, "credential-one"),
      ).rejects.toThrow("account issue list");
    expect(run).not.toHaveBeenCalled();
  });
});
