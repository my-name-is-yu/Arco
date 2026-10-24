import { OperationError, toolFailureSchema } from "../src/shared/errors";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFixtureBackend,
  type ArcoBackend,
} from "../src/server/composition";
import { FIXTURE_REPO } from "../src/server/fixture";
import { LINEAR_FIXTURE_SCOPE } from "../src/server/linear/fixture";
import { createArcoServer } from "../src/server/mcp";
import {
  issuePresentationSummarySchema,
  launchContextSchema,
  MAX_PRESENTED_ISSUES,
  nativeIssueTargetSchema,
  personalLaunchContext,
} from "../src/shared/launch";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    readFile: vi.fn((...args: Parameters<typeof original.readFile>) => {
      const [path] = args;
      if (path instanceof URL && path.pathname.endsWith("/arco.html"))
        return Promise.resolve("<!doctype html><main>Arco UI</main>");
      return original.readFile(...args);
    }),
  };
});

const github = { source: "github", repo: FIXTURE_REPO, number: 42 } as const;
const linearRef = {
  ...LINEAR_FIXTURE_SCOPE,
  issueId: "fixture-linear-42",
} as const;
const linear = { source: "linear", ...linearRef } as const;
const presentationTools = ["arco_show_issue", "arco_open_issue"] as const;

let backend: ArcoBackend;
let server: ReturnType<typeof createArcoServer>;
let client: Client;
beforeEach(async () => {
  backend = await createFixtureBackend();
  server = createArcoServer(backend);
  client = new Client({ name: "issue presentation test", version: "1" });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});
afterEach(async () => {
  await client?.close();
  await server?.close();
  backend?.cleanup();
});

describe("explicit issue presentation", () => {
  it("keeps inline issue rendering separate from explicit detail and workspace entrances", async () => {
    const { tools } = await client.listTools();
    for (const [name, uri, mode] of [
      ["arco_show_issue", "ui://arco/issue-card", "inline"],
      ["arco_open_issue", "ui://arco/issues", "fullscreen"],
    ]) {
      const tool = tools.find((candidate) => candidate.name === name)!;
      expect(tool._meta?.ui).toEqual({ resourceUri: uri });
      expect(tool._meta?.["openai/ui"]).toEqual({
        preferredModelDisplayMode: mode,
      });
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
      expect(tool.inputSchema.required).toEqual(["target"]);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    for (const [name, entrypoint] of [
      ["arco_open", "global"],
      ["arco_open_project", "thread"],
    ]) {
      const tool = tools.find((candidate) => candidate.name === name)!;
      expect(tool._meta?.ui).toEqual({ resourceUri: "ui://arco/issues" });
      expect(tool._meta?.["openai/ui"]).toEqual({
        entrypoints: [{ type: entrypoint }],
        preferredModelDisplayMode: "fullscreen",
      });
      expect(tool.description).toContain("only when explicitly requested");
      expect(tool.description).toContain("arco_show_issue");
    }
  });

  it("serves the same component with distinct inline and fullscreen preferences", async () => {
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining(["ui://arco/issues", "ui://arco/issue-card"]),
    );
    for (const [uri, mode] of [
      ["ui://arco/issue-card", "inline"],
      ["ui://arco/issues", "fullscreen"],
    ]) {
      const { contents } = await client.readResource({ uri });
      expect(contents).toHaveLength(1);
      expect(contents[0]).toMatchObject({
        uri,
        mimeType: "text/html;profile=mcp-app",
        text: "<!doctype html><main>Arco UI</main>",
        _meta: {
          "openai/ui": {
            availableDisplayModes: ["inline", "fullscreen"],
            preferredDisplayMode: mode,
          },
          ui: { prefersBorder: false },
        },
      });
    }
  });

  it.each(["github", "linear"] as const)(
    "opens an explicitly requested %s list through the common workspace entrance",
    async (source) => {
      const githubConnection = vi.spyOn(backend.service, "connection");
      const linearConnection = vi.spyOn(backend.linearService, "call");
      const settings = vi.spyOn(backend.stateStore, "updateSettings");
      const draft = vi.spyOn(backend.stateStore, "writeDraft");
      const annotations = vi.spyOn(
        backend.stateStore,
        "writeAnnotationSnapshot",
      );
      const response = await client.callTool({
        name: "arco_open",
        arguments: { source },
      });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toMatchObject({
        connected: true,
        launch: { ...personalLaunchContext, source },
      });
      expect(
        launchContextSchema.parse(
          (response.structuredContent as { launch?: unknown } | undefined)
            ?.launch,
        ).source,
      ).toBe(source);
      if (source === "linear") {
        expect(linearConnection).toHaveBeenCalledExactlyOnceWith(
          "linear_connection",
          {},
        );
        expect(githubConnection).not.toHaveBeenCalled();
      } else {
        expect(githubConnection).toHaveBeenCalledExactlyOnceWith();
        expect(linearConnection).not.toHaveBeenCalled();
      }
      for (const write of [settings, draft, annotations])
        expect(write).not.toHaveBeenCalled();
      const { tools } = await client.listTools();
      const open = tools.find((tool) => tool.name === "arco_open")!;
      expect(open.inputSchema.additionalProperties).toBe(false);
      expect(open.inputSchema.required ?? []).not.toContain("source");
      expect(open._meta?.["openai/ui"]).toEqual({
        entrypoints: [{ type: "global" }],
        preferredModelDisplayMode: "fullscreen",
      });
    },
  );

  it("preserves the personal launch when no source is requested", async () => {
    const githubConnection = vi.spyOn(backend.service, "connection");
    const linearConnection = vi.spyOn(backend.linearService, "call");
    const response = await client.callTool({
      name: "arco_open",
      arguments: {},
    });
    expect(response.isError).not.toBe(true);
    expect(
      (response.structuredContent as { launch?: unknown } | undefined)?.launch,
    ).toEqual(personalLaunchContext);
    expect(githubConnection).toHaveBeenCalledExactlyOnceWith();
    expect(linearConnection).not.toHaveBeenCalled();
  });

  it.each([
    { source: "jira" },
    { source: "" },
    { source: null },
    { source: { name: "linear" } },
    { source: "linear", target: linear },
  ])(
    "rejects unsupported workspace source input before any connection call: %j",
    async (args) => {
      const githubConnection = vi.spyOn(backend.service, "connection");
      const linearConnection = vi.spyOn(backend.linearService, "call");
      const response = await client.callTool({
        name: "arco_open",
        arguments: args,
      });
      expect(response.isError).toBe(true);
      expect(response.structuredContent).toBeUndefined();
      expect(githubConnection).not.toHaveBeenCalled();
      expect(linearConnection).not.toHaveBeenCalled();
    },
  );

  it.each(presentationTools)(
    "%s returns the exact GitHub issue without changing local state or selecting a fallback",
    async (name) => {
      const issue = await backend.service.get(github);
      const read = vi.spyOn(backend.service, "get");
      const otherProvider = vi.spyOn(backend.linearService, "call");
      const list = vi.spyOn(backend.service, "list");
      const settings = vi.spyOn(backend.stateStore, "updateSettings");
      const draft = vi.spyOn(backend.stateStore, "writeDraft");
      const annotations = vi.spyOn(
        backend.stateStore,
        "writeAnnotationSnapshot",
      );
      const response = await client.callTool({
        name,
        arguments: { target: github },
      });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toEqual({
        launch: { ...personalLaunchContext, target: github },
        issue,
      });
      expect(read).toHaveBeenCalledExactlyOnceWith({
        repo: github.repo,
        number: 42,
      });
      for (const untouched of [
        otherProvider,
        list,
        settings,
        draft,
        annotations,
      ])
        expect(untouched).not.toHaveBeenCalled();
    },
  );

  it.each(presentationTools)(
    "%s preserves the exact native Linear scope",
    async (name) => {
      const issue = await backend.linearService.call(
        "linear_get_issue",
        linearRef,
      );
      const read = vi.spyOn(backend.linearService, "call");
      const otherProvider = vi.spyOn(backend.service, "get");
      const response = await client.callTool({
        name,
        arguments: { target: linear },
      });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toEqual({
        launch: { ...personalLaunchContext, target: linear },
        issue,
      });
      expect(read).toHaveBeenCalledExactlyOnceWith(
        "linear_get_issue",
        linearRef,
      );
      expect(otherProvider).not.toHaveBeenCalled();
    },
  );

  it("accepts GitHub repository casing while retaining the returned canonical reference", async () => {
    const issue = await backend.service.get(github);
    vi.spyOn(backend.service, "get").mockResolvedValue(issue);
    const response = await client.callTool({
      name: "arco_show_issue",
      arguments: { target: { ...github, repo: github.repo.toUpperCase() } },
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({
      launch: { ...personalLaunchContext, target: github },
      issue,
    });
  });

  it.each([
    {},
    { target: { repo: FIXTURE_REPO, number: 42 } },
    { target: { ...github, repo: "../private" } },
    { target: { ...github, number: 0 } },
    { target: { ...github, issueId: linear.issueId } },
    { target: { ...linear, repo: FIXTURE_REPO } },
    { target: { ...linear, issueId: "" } },
    { target: github, fallback: linear },
  ])(
    "rejects invalid or mixed input before any provider read: %j",
    async (args) => {
      const githubRead = vi.spyOn(backend.service, "get");
      const linearRead = vi.spyOn(backend.linearService, "call");
      const response = await client.callTool({
        name: "arco_show_issue",
        arguments: args,
      });
      expect(response.isError).toBe(true);
      expect(response.structuredContent).toBeUndefined();
      expect(githubRead).not.toHaveBeenCalled();
      expect(linearRead).not.toHaveBeenCalled();
    },
  );

  it.each(["repo", "number"] as const)(
    "rejects a returned GitHub %s mismatch",
    async (field) => {
      const issue = await backend.service.get(github);
      vi.spyOn(backend.service, "get").mockResolvedValue({
        ...issue,
        [field]: field === "repo" ? "other/repository" : 43,
      });
      const response = await client.callTool({
        name: "arco_show_issue",
        arguments: { target: github },
      });
      expect(response).toMatchObject({
        isError: true,
        content: [
          { type: "text", text: expect.stringContaining("different issue") },
        ],
      });
      expect(
        toolFailureSchema.safeParse(response.structuredContent).success,
      ).toBe(true);
      expect(response.structuredContent).not.toHaveProperty("launch");
      expect(response.structuredContent).not.toHaveProperty("issue");
    },
  );

  it.each([
    { ...linear, connectionId: "different-connection" },
    { ...linear, workspaceId: "different-workspace" },
    { ...linear, teamId: "different-team" },
    { ...linear, issueId: "unknown-issue" },
  ])(
    "rejects an inaccessible or unknown Linear target without fallback: %j",
    async (target) => {
      const read = vi.spyOn(backend.linearService, "call");
      const otherProvider = vi.spyOn(backend.service, "get");
      const response = await client.callTool({
        name: "arco_show_issue",
        arguments: { target },
      });
      expect(response.isError).toBe(true);
      expect(
        toolFailureSchema.safeParse(response.structuredContent).success,
      ).toBe(true);
      expect(response.structuredContent).not.toHaveProperty("launch");
      expect(response.structuredContent).not.toHaveProperty("issue");
      expect(read).toHaveBeenCalledTimes(1);
      expect(otherProvider).not.toHaveBeenCalled();
    },
  );

  it.each(["connectionId", "workspaceId", "teamId", "issueId"] as const)(
    "rejects a returned Linear %s mismatch with native-ID resolution guidance",
    async (field) => {
      const issue = await backend.linearService.call(
        "linear_get_issue",
        linearRef,
      );
      vi.spyOn(backend.linearService, "call").mockResolvedValue({
        ...issue,
        [field]: "different",
      });
      const response = await client.callTool({
        name: "arco_open_issue",
        arguments: { target: linear },
      });
      expect(response).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: expect.stringContaining("linear_resolve_issue"),
          },
        ],
      });
      expect(
        toolFailureSchema.safeParse(response.structuredContent).success,
      ).toBe(true);
      expect(response.structuredContent).not.toHaveProperty("launch");
      expect(response.structuredContent).not.toHaveProperty("issue");
    },
  );

  it("rejects a Linear identifier alias instead of keeping it as a native issue ID", async () => {
    const issue = await backend.linearService.call(
      "linear_get_issue",
      linearRef,
    );
    vi.spyOn(backend.linearService, "call").mockResolvedValue(issue);
    const response = await client.callTool({
      name: "arco_show_issue",
      arguments: { target: { ...linear, issueId: "YU-42" } },
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      { type: "text", text: expect.stringContaining("linear_resolve_issue") },
    ]);
  });

  it.each(presentationTools)(
    "%s returns provider failures without fallback content",
    async (name) => {
      const failed = vi
        .spyOn(backend.service, "get")
        .mockRejectedValue(
          new OperationError("Issue access denied.", "forbidden"),
        );
      const list = vi.spyOn(backend.service, "list");
      const account = vi.spyOn(backend.service, "accountIssues");
      const otherProvider = vi.spyOn(backend.linearService, "call");
      const response = await client.callTool({
        name,
        arguments: { target: github },
      });
      expect(response).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Issue access denied." }],
      });
      expect(
        toolFailureSchema.safeParse(response.structuredContent).success,
      ).toBe(true);
      expect(response.structuredContent).not.toHaveProperty("launch");
      expect(response.structuredContent).not.toHaveProperty("issue");
      expect(failed).toHaveBeenCalledTimes(1);
      for (const untouched of [list, account, otherProvider])
        expect(untouched).not.toHaveBeenCalled();
    },
  );

  it("keeps current launch values valid and validates optional native targets strictly", () => {
    expect(launchContextSchema.parse(personalLaunchContext)).toEqual(
      personalLaunchContext,
    );
    for (const target of [github, linear])
      expect(
        launchContextSchema.parse({ ...personalLaunchContext, target }).target,
      ).toEqual(target);
    expect(
      nativeIssueTargetSchema.safeParse({ ...github, ...LINEAR_FIXTURE_SCOPE })
        .success,
    ).toBe(false);
  });
});

describe("grouped inline issue presentation", () => {
  it("declares a read-only inline list without a workspace entrypoint", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === "arco_show_issues",
    )!;
    expect(tool._meta?.ui).toEqual({ resourceUri: "ui://arco/issue-card" });
    expect(tool._meta?.["openai/ui"]).toEqual({
      preferredModelDisplayMode: "inline",
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(tool.inputSchema.required).toEqual(["targets"]);
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.inputSchema.properties?.targets).toMatchObject({
      minItems: 2,
      maxItems: MAX_PRESENTED_ISSUES,
    });
    expect(tool.description).toContain("2–4");
  });

  it("preserves mixed-provider order and canonical native scope while omitting bodies and comments", async () => {
    const githubRead = vi.spyOn(backend.service, "get");
    const linearRead = vi.spyOn(backend.linearService, "call");
    const list = vi.spyOn(backend.service, "list");
    const settings = vi.spyOn(backend.stateStore, "updateSettings");
    const draft = vi.spyOn(backend.stateStore, "writeDraft");
    const annotations = vi.spyOn(backend.stateStore, "writeAnnotationSnapshot");
    const response = await client.callTool({
      name: "arco_show_issues",
      arguments: {
        targets: [
          linear,
          github,
          linear,
          { ...github, repo: github.repo.toUpperCase() },
        ],
      },
    });
    expect(response.isError).not.toBe(true);
    const launch = launchContextSchema.parse(
      (response.structuredContent as { launch?: unknown } | undefined)?.launch,
    );
    expect(launch.target).toBeUndefined();
    expect(launch.issues).toHaveLength(2);
    expect(launch.issues?.[0]).toMatchObject({
      ...linear,
      identifier: "YU-42",
      state: { name: "In Progress", type: "started" },
    });
    expect(launch.issues?.[1]).toMatchObject({
      ...github,
      id: "fixture-issue-42",
      state: "open",
      stateReason: null,
    });
    for (const issue of launch.issues ?? []) {
      expect(issuePresentationSummarySchema.safeParse(issue).success).toBe(
        true,
      );
      expect(issue).not.toHaveProperty("body");
      expect(issue).not.toHaveProperty("comments");
      expect(issue).not.toHaveProperty("projects");
    }
    expect(Object.keys(response.structuredContent ?? {})).toEqual(["launch"]);
    expect(response.content).toEqual([
      { type: "text", text: JSON.stringify(response.structuredContent) },
    ]);
    expect(githubRead).toHaveBeenCalledExactlyOnceWith({
      repo: github.repo,
      number: github.number,
    });
    expect(linearRead).toHaveBeenCalledExactlyOnceWith(
      "linear_get_issue",
      linearRef,
    );
    expect(response._meta).toEqual({
      issueDetails: [
        await linearRead.mock.results[0].value,
        await githubRead.mock.results[0].value,
      ],
    });
    expect(response._meta?.issueDetails).toEqual([
      expect.objectContaining({ ...linear, body: expect.any(String) }),
      expect.objectContaining({ ...github, body: expect.any(String) }),
    ]);
    for (const untouched of [list, settings, draft, annotations])
      expect(untouched).not.toHaveBeenCalled();
  });

  it("returns all four fetched details only to the app without additional reads", async () => {
    const githubRead = vi.spyOn(backend.service, "get");
    const linearRead = vi.spyOn(backend.linearService, "call");
    const targets = [
      linear,
      github,
      { ...linear, issueId: "fixture-linear-43" },
      { ...github, number: 43 },
    ];
    const response = await client.callTool({
      name: "arco_show_issues",
      arguments: { targets },
    });
    expect(response.isError).not.toBe(true);
    const launch = launchContextSchema.parse(
      (response.structuredContent as { launch?: unknown } | undefined)?.launch,
    );
    expect(launch.issues).toHaveLength(MAX_PRESENTED_ISSUES);
    expect(response._meta?.issueDetails).toEqual([
      await linearRead.mock.results[0].value,
      await githubRead.mock.results[0].value,
      await linearRead.mock.results[1].value,
      await githubRead.mock.results[1].value,
    ]);
    expect(githubRead.mock.calls).toEqual([
      [{ repo: github.repo, number: 42 }],
      [{ repo: github.repo, number: 43 }],
    ]);
    expect(linearRead.mock.calls).toEqual([
      ["linear_get_issue", linearRef],
      ["linear_get_issue", { ...linearRef, issueId: "fixture-linear-43" }],
    ]);
    expect(response.structuredContent).not.toHaveProperty("issueDetails");
    expect(response.content).toEqual([
      { type: "text", text: JSON.stringify({ launch }) },
    ]);
    for (const issue of launch.issues ?? []) {
      expect(issue).not.toHaveProperty("body");
      expect(issue).not.toHaveProperty("comments");
    }
  });

  it.each([
    {},
    { targets: [] },
    { targets: [github] },
    {
      targets: Array.from({ length: MAX_PRESENTED_ISSUES + 1 }, (_, index) => ({
        ...github,
        number: index + 1,
      })),
    },
    { targets: [github, { ...linear, number: 42 }] },
    { targets: [github, linear], source: "github" },
  ])(
    "rejects invalid or unbounded lists before provider reads: %j",
    async (args) => {
      const githubRead = vi.spyOn(backend.service, "get");
      const linearRead = vi.spyOn(backend.linearService, "call");
      const response = await client.callTool({
        name: "arco_show_issues",
        arguments: args,
      });
      expect(response.isError).toBe(true);
      expect(githubRead).not.toHaveBeenCalled();
      expect(linearRead).not.toHaveBeenCalled();
    },
  );

  it("rejects repeated aliases of just one issue before reading it", async () => {
    const read = vi.spyOn(backend.service, "get");
    const response = await client.callTool({
      name: "arco_show_issues",
      arguments: {
        targets: [github, { ...github, repo: github.repo.toUpperCase() }],
      },
    });
    expect(response).toMatchObject({
      isError: true,
      structuredContent: { error: { kind: "invalid-input" } },
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps Linear connection and team scope distinct during deduplication", async () => {
    const read = vi.spyOn(backend.linearService, "call");
    const response = await client.callTool({
      name: "arco_show_issues",
      arguments: { targets: [linear, { ...linear, teamId: "different-team" }] },
    });
    expect(response.isError).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith("linear_get_issue", {
      ...linearRef,
      teamId: "different-team",
    });
    expect(response.structuredContent).not.toHaveProperty("launch");
  });

  it.each(["github", "linear"] as const)(
    "rejects a canonical %s mismatch without returning a partial list",
    async (source) => {
      if (source === "github") {
        const issue = await backend.service.get(github);
        vi.spyOn(backend.service, "get").mockResolvedValue({
          ...issue,
          number: 99,
        });
      } else {
        const issue = await backend.linearService.call(
          "linear_get_issue",
          linearRef,
        );
        vi.spyOn(backend.linearService, "call").mockResolvedValue({
          ...issue,
          issueId: "other-native-id",
        });
      }
      const response = await client.callTool({
        name: "arco_show_issues",
        arguments: { targets: [github, linear] },
      });
      expect(response).toMatchObject({
        isError: true,
        structuredContent: { error: { kind: "invalid-response" } },
      });
      expect(response.structuredContent).not.toHaveProperty("launch");
      expect(response.structuredContent).not.toHaveProperty("issues");
      expect(response._meta?.issueDetails).toBeUndefined();
    },
  );

  it("returns a source failure without broadening the requested list", async () => {
    vi.spyOn(backend.linearService, "call").mockRejectedValue(
      new OperationError("Issue access denied.", "forbidden"),
    );
    const list = vi.spyOn(backend.service, "list");
    const account = vi.spyOn(backend.service, "accountIssues");
    const response = await client.callTool({
      name: "arco_show_issues",
      arguments: { targets: [github, linear] },
    });
    expect(response).toMatchObject({
      isError: true,
      structuredContent: {
        error: { kind: "forbidden", message: "Issue access denied." },
      },
    });
    expect(response.structuredContent).not.toHaveProperty("launch");
    expect(response._meta?.issueDetails).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
    expect(account).not.toHaveBeenCalled();
  });

  it("rejects malformed summaries and conflicting single/list launch targets", async () => {
    const response = await client.callTool({
      name: "arco_show_issues",
      arguments: { targets: [github, linear] },
    });
    const launch = launchContextSchema.parse(
      (response.structuredContent as { launch?: unknown } | undefined)?.launch,
    );
    expect(
      launchContextSchema.safeParse({ ...launch, target: github }).success,
    ).toBe(false);
    expect(
      launchContextSchema.safeParse({ ...launch, issues: [launch.issues?.[0]] })
        .success,
    ).toBe(false);
    expect(
      launchContextSchema.safeParse({
        ...launch,
        issues: Array.from(
          { length: MAX_PRESENTED_ISSUES + 1 },
          () => launch.issues?.[0],
        ),
      }).success,
    ).toBe(false);
    expect(
      issuePresentationSummarySchema.safeParse({
        ...launch.issues?.[0],
        body: "unexpected content",
      }).success,
    ).toBe(false);
  });
});
