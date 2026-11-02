import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeSymphonyUrl,
  symphonyConnectionSchema,
  symphonyIssueMatches,
  symphonyRuntimeContext,
  symphonyRuntimeContextSchema,
  type SymphonyConnection,
} from "../src/shared/symphony";
import {
  createSymphonyService,
  parseSymphonyState,
} from "../src/server/symphony";
import {
  createSymphonyFixtureService,
  SYMPHONY_FIXTURE_CONNECTIONS,
} from "../src/server/symphony-fixture";
import { createFixtureService } from "../src/server/fixture";
import {
  createLinearFixtureService,
  LINEAR_FIXTURE_SCOPE,
} from "../src/server/linear/fixture";
import { registerSymphonyTools } from "../src/server/symphony-tools";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LinearIssue } from "../src/shared/linear";

const connection: SymphonyConnection = {
  id: "local",
  name: "Local Symphony",
  baseUrl: "http://127.0.0.1:4318",
};
const generatedAt = "2026-11-01T12:00:00Z";
const running = {
  issue_id: "42",
  issue_identifier: "GH-42",
  issue_url: "https://github.com/yu/Arco/issues/42",
  state: "open",
  session_id: "thread-1-turn-2",
  last_event: "notification",
  last_message: "Working on tests",
  started_at: generatedAt,
  last_event_at: generatedAt,
  turn_count: 2,
  tokens: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
};
function state(overrides: object = {}) {
  return {
    generated_at: generatedAt,
    running: [running],
    retrying: [],
    blocked: [],
    codex_totals: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      seconds_running: 30,
    },
    rate_limits: null,
    ...overrides,
  };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function setup(request = vi.fn<typeof globalThis.fetch>()) {
  let connections = [connection];
  return {
    request,
    replace: (values: SymphonyConnection[]) => {
      connections = values;
    },
    service: createSymphonyService({
      fetch: request,
      readSettings: async () => ({
        settings: { symphonyConnections: connections },
      }),
    }),
  };
}
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("Symphony connection boundary", () => {
  it.each([
    "http://127.0.0.1:4318/",
    "http://localhost:4318",
    "http://[::1]:4318",
    "https://symphony.example/prefix/",
  ])("accepts existing local or HTTPS routes: %s", (url) => {
    expect(
      symphonyConnectionSchema.parse({ ...connection, baseUrl: url }).baseUrl,
    ).toBe(normalizeSymphonyUrl(url));
  });
  it.each([
    "http://remote.example:4318",
    "http://localhost.evil:4318",
    "https://user:password@example.com",
    "https://example.com?token=secret",
    "https://example.com#secret",
    "file:///tmp/test",
    "ftp://localhost",
    "not a URL",
  ])("rejects unsupported or credential-bearing URLs: %s", (baseUrl) => {
    expect(
      symphonyConnectionSchema.safeParse({ ...connection, baseUrl }).success,
    ).toBe(false);
  });
  it("requires an explicit saved connection and uses its latest URL", async () => {
    const source = setup();
    await expect(
      source.service.getState({ connectionId: "missing" }),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(source.request).not.toHaveBeenCalled();
    source.request.mockResolvedValueOnce(json(state()));
    source.replace([
      { ...connection, baseUrl: "https://worker.example/symphony" },
    ]);
    const result = await source.service.getState({
      connectionId: connection.id,
    });
    expect(result.connectionId).toBe(connection.id);
    expect(source.request).toHaveBeenCalledWith(
      "https://worker.example/symphony/api/v1/state",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        credentials: "omit",
      }),
    );
  });
  it("coalesces overlapping requests without caching later observations", async () => {
    const source = setup();
    let finish!: (response: Response) => void;
    source.request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const first = source.service.getState({ connectionId: connection.id });
    const second = source.service.getState({ connectionId: connection.id });
    await vi.waitFor(() => expect(source.request).toHaveBeenCalledTimes(1));
    finish(json(state()));
    expect((await Promise.all([first, second]))[0].rows).toHaveLength(1);
    source.request.mockResolvedValueOnce(json(state({ running: [] })));
    expect(
      (await source.service.getState({ connectionId: connection.id })).rows,
    ).toEqual([]);
    expect(source.request).toHaveBeenCalledTimes(2);
  });
  it("normalizes official runtime data and ignores extension fields", async () => {
    const source = setup();
    source.request.mockResolvedValueOnce(
      json(
        state({
          extra: "ignored",
          retrying: [
            {
              issue_id: "43",
              issue_identifier: "GH-43",
              attempt: 2,
              due_at: generatedAt,
              error: "Worker unavailable",
            },
          ],
          blocked: [
            {
              issue_id: "44",
              issue_identifier: "GH-44",
              blocked_at: generatedAt,
              error: "Input required",
            },
          ],
          rate_limits: {
            primary: {
              used_percent: 12,
              window_minutes: 300,
              hiddenToken: "do-not-forward",
            },
            token: "do-not-forward",
          },
        }),
      ),
    );
    const result = await source.service.getState({
      connectionId: connection.id,
    });
    expect(result.rows.map((row) => row.runtimeStatus)).toEqual([
      "running",
      "retrying",
      "blocked",
    ]);
    expect(result.rows[0]).toMatchObject({
      issueIdentifier: "GH-42",
      tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      turnCount: 2,
    });
    expect(result.rows[1]).toMatchObject({
      tokens: null,
      retryAttempt: 2,
      retryDueAt: generatedAt,
    });
    expect(result.rateLimits).toEqual({
      primary: { used_percent: 12, window_minutes: 300 },
    });
    expect(JSON.stringify(result)).not.toContain("do-not-forward");
  });
  it("accepts absent optional blocked metrics but rejects malformed runtime identities", () => {
    expect(
      parseSymphonyState(
        {
          generated_at: generatedAt,
          running: [],
          retrying: [],
          codex_totals: {},
        },
        "one",
      ).rows,
    ).toEqual([]);
    expect(() =>
      parseSymphonyState(
        state({ running: [{ ...running, issue_id: null }] }),
        "one",
      ),
    ).toThrow();
    expect(() =>
      parseSymphonyState(state({ retrying: [running] }), "one"),
    ).toThrow();
  });
  it("bounds event summaries and strips credentials and query strings from issue links", () => {
    const result = parseSymphonyState(
      state({
        running: [
          {
            ...running,
            last_message: "x".repeat(5000),
            issue_url:
              "https://github.com/yu/Arco/issues/42?token=secret#comment",
          },
        ],
      }),
      "one",
    );
    expect(result.rows[0].lastMessage).toHaveLength(4000);
    expect(result.rows[0].issueUrl).toBe(
      "https://github.com/yu/Arco/issues/42",
    );
    expect(
      parseSymphonyState(
        state({
          running: [
            { ...running, issue_url: "https://user:secret@example.com/issue" },
          ],
        }),
        "one",
      ).rows[0].issueUrl,
    ).toBeNull();
  });
  it.each(["snapshot_timeout", "snapshot_unavailable"])(
    "treats HTTP 200 %s as a failure without forwarding its message",
    async (code) => {
      const source = setup();
      source.request.mockResolvedValueOnce(
        json({
          generated_at: generatedAt,
          error: { code, message: "private-token-secret" },
        }),
      );
      await expect(
        source.service.getState({ connectionId: connection.id }),
      ).rejects.toMatchObject({
        code: code === "snapshot_timeout" ? "timeout" : "unavailable",
      });
    },
  );
  it.each([301, 302, 401, 403, 429, 503])(
    "does not follow redirects or expose upstream errors: %s",
    async (status) => {
      const source = setup();
      source.request.mockResolvedValueOnce(
        new Response("private-token-secret", {
          status,
          headers: { location: "https://login.example?secret=credential" },
        }),
      );
      await expect(
        source.service.getState({ connectionId: connection.id }),
      ).rejects.not.toThrow("private-token-secret");
      expect(source.request).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects HTML and oversized streamed bodies", async () => {
    const request = vi.fn<typeof globalThis.fetch>();
    const service = createSymphonyService({
      readSettings: async () => ({
        settings: { symphonyConnections: [connection] },
      }),
      fetch: request,
      maxBodyBytes: 64,
    });
    request.mockResolvedValueOnce(
      new Response("<html>login</html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      service.getState({ connectionId: connection.id }),
    ).rejects.toMatchObject({ code: "invalid-response" });
    request.mockResolvedValueOnce(json({ body: "x".repeat(100) }));
    await expect(
      service.getState({ connectionId: connection.id }),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
  it("bounds the full real HTTP body read, including a stalled stream", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
      response.write("{");
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test listener");
    const service = createSymphonyService({
      readSettings: async () => ({
        settings: {
          symphonyConnections: [
            { ...connection, baseUrl: `http://127.0.0.1:${address.port}` },
          ],
        },
      }),
      timeoutMs: 50,
    });
    await expect(
      service.getState({ connectionId: connection.id }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
  it("returns missing runtime only for the official 404 envelope", async () => {
    const source = setup();
    source.request.mockResolvedValueOnce(
      json(
        { error: { code: "issue_not_found", message: "Issue not found" } },
        404,
      ),
    );
    expect(
      await source.service.getIssue({
        connectionId: connection.id,
        issueIdentifier: "GH-43",
      }),
    ).toEqual({
      connectionId: connection.id,
      issueIdentifier: "GH-43",
      found: false,
      runtime: null,
    });
    source.request.mockResolvedValueOnce(
      json({ error: { code: "proxy_missing" } }, 404),
    );
    await expect(
      source.service.getIssue({
        connectionId: connection.id,
        issueIdentifier: "GH-43",
      }),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
  it.each(["running", "retrying", "blocked"] as const)(
    "reads %s issue details without inventing historical logs",
    async (status) => {
      const source = setup();
      source.request.mockResolvedValueOnce(
        json({
          issue_id: "42",
          issue_identifier: "GH-42",
          status,
          workspace: { path: "/work/GH-42", host: null },
          [status === "retrying" ? "retry" : status]: {
            session_id: "thread",
            attempt: 2,
            error: "Input required",
          },
        }),
      );
      const result = await source.service.getIssue({
        connectionId: connection.id,
        issueIdentifier: "GH-42",
      });
      expect(result.found).toBe(true);
      expect(result.runtime).toMatchObject({
        runtimeStatus: status,
        workspacePath: "/work/GH-42",
      });
      expect(result).not.toHaveProperty("logs");
    },
  );
  it("probes a URL without saving or attaching its location to runtime output", async () => {
    const source = setup();
    source.request.mockResolvedValueOnce(json(state()));
    const result = await source.service.probe({
      baseUrl: "https://private.example/prefix/",
    });
    expect(result.connectionId).toBe("probe");
    expect(JSON.stringify(result)).not.toContain("private.example");
  });
});

describe("native identity and explicit runtime sharing", () => {
  it("matches native fixture rows and leaves unknown runtime issues unmatched", async () => {
    const service = createSymphonyFixtureService();
    const github = SYMPHONY_FIXTURE_CONNECTIONS[0];
    const githubState = await service.getState({ connectionId: github.id });
    const native = await createFixtureService().get({
      repo: "yu/Arco",
      number: 42,
    });
    expect(
      symphonyIssueMatches(github.binding, githubState.rows[0], native),
    ).toBe(true);
    expect(
      symphonyIssueMatches(github.binding, githubState.rows[2], native),
    ).toBe(false);
    expect(
      symphonyIssueMatches(
        {
          ...github.binding!,
          source: "github",
          repo: "another/repo",
          prepareLabels: [],
          reviewLabels: [],
        },
        githubState.rows[0],
        native,
      ),
    ).toBe(false);
    const linear = SYMPHONY_FIXTURE_CONNECTIONS[1];
    const linearState = await service.getState({ connectionId: linear.id });
    const nativeLinear = (await createLinearFixtureService().call(
      "linear_get_issue",
      {
        ...LINEAR_FIXTURE_SCOPE,
        issueId: "fixture-linear-42",
      },
    )) as LinearIssue;
    expect(
      symphonyIssueMatches(linear.binding, linearState.rows[0], nativeLinear),
    ).toBe(true);
    expect(
      symphonyIssueMatches(linear.binding, linearState.rows[0], {
        ...nativeLinear,
        workspaceId: "another-workspace",
      }),
    ).toBe(false);
    expect(
      (
        await service.getIssue({
          connectionId: linear.id,
          issueIdentifier: "YU-43",
        })
      ).found,
    ).toBe(false);
  });
  it("does not accept identifiers alone or conflicting provider URLs", () => {
    const row = parseSymphonyState(state(), "one").rows[0];
    const binding = SYMPHONY_FIXTURE_CONNECTIONS[0].binding;
    const native = {
      repo: "yu/Arco",
      number: 42,
      url: "https://github.com/yu/Arco/issues/42",
    };
    expect(symphonyIssueMatches(undefined, row, native)).toBe(false);
    expect(
      symphonyIssueMatches(
        binding,
        { ...row, issueUrl: "https://github.com/another/repo/issues/42" },
        native,
      ),
    ).toBe(false);
    expect(
      symphonyIssueMatches(
        binding,
        { ...row, issueUrl: "https://github.com:444/yu/Arco/issues/42" },
        native,
      ),
    ).toBe(false);
    expect(
      symphonyIssueMatches(binding, { ...row, issueUrl: null }, native),
    ).toBe(true);
  });
  it("shares bounded runtime context without server paths, hosts, or rate payloads", () => {
    const row = parseSymphonyState(
      state({
        running: [
          {
            ...running,
            worker_host: "private-worker",
            workspace_path: "/private/path",
          },
        ],
      }),
      connection.id,
    ).rows[0];
    const result = symphonyRuntimeContextSchema.parse(
      symphonyRuntimeContext(connection, row, generatedAt, {
        source: "github",
        url: "https://github.com/yu/Arco/issues/42",
        title: "Issue",
        identifier: "#42",
      }),
    );
    expect(result.issue?.title).toBe("Issue");
    expect(JSON.stringify(result)).not.toContain("private");
    expect(
      symphonyRuntimeContextSchema.safeParse({
        ...result,
        issue: {
          ...result.issue,
          url: "https://user:password@github.com/yu/Arco/issues/42",
        },
      }).success,
    ).toBe(false);
  });
  it("registers read-only tools and keeps arbitrary URL probing app-only", () => {
    const registerTool = vi.fn();
    registerSymphonyTools(
      { registerTool } as unknown as McpServer,
      createSymphonyFixtureService(),
    );
    expect(registerTool.mock.calls.map((call) => call[0])).toEqual([
      "arco_symphony_state",
      "arco_symphony_issue",
      "arco_symphony_test_connection",
    ]);
    for (const call of registerTool.mock.calls)
      expect(call[1].annotations.readOnlyHint).toBe(true);
    expect(registerTool.mock.calls[2][1]._meta.ui.visibility).toEqual(["app"]);
  });
});
