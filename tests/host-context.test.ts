import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionAnnotationContext } from "../src/shared/contracts";
import {
  personalLaunchContext,
  type LaunchContext,
} from "../src/shared/launch";
import { connectHost } from "../src/ui/host";
import { ToolCallError } from "../src/shared/errors";
import { toolFailure } from "./tool-failure";

const fixture = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  modelContextSupported: true,
  change: undefined as ((change: Record<string, unknown>) => void) | undefined,
  toolResult: undefined as
    | ((result: {
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
      }) => void)
    | undefined,
  connecting: undefined as (() => void) | undefined,
  display: vi.fn<(params: { mode: string }) => Promise<{ mode: string }>>(),
  call: vi.fn<
    (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  >(),
  update:
    vi.fn<
      (params: Record<string, unknown>) => Promise<Record<string, unknown>>
    >(),
}));

vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: class {
    getHostContext() {
      return fixture.context;
    }
    getHostCapabilities() {
      return fixture.modelContextSupported
        ? { experimental: { "openai/modelContext": {} } }
        : {};
    }
    set onhostcontextchanged(handler: typeof fixture.change) {
      fixture.change = handler;
    }
    set ontoolresult(handler: typeof fixture.toolResult) {
      fixture.toolResult = handler;
    }
    connect = async () => fixture.connecting?.();
    requestDisplayMode = fixture.display;
    callServerTool = fixture.call;
    setNotificationHandler = () => undefined;
    updateModelContext(params: Record<string, unknown>) {
      return fixture.update(params);
    }
  },
  applyDocumentTheme: vi.fn(),
  applyHostStyleVariables: vi.fn(),
}));

const annotationFor = (
  number: number,
  comment?: string,
): SelectionAnnotationContext => ({
  number,
  issue: {
    source: "github",
    repo: "yu/Arco",
    number,
    id: `issue-${number}`,
    title: `Issue ${number}`,
    url: `https://github.com/yu/Arco/issues/${number}`,
    state: "open",
  },
  selection: {
    text: `Selected words ${number}`,
    origin: "ui",
    ...(comment === undefined ? {} : { comment }),
  },
});
const linearAnnotation = (number: number): SelectionAnnotationContext => ({
  number,
  issue: {
    source: "linear",
    connectionId: "default",
    workspaceId: "workspace",
    teamId: "team",
    id: `linear-issue-${number}`,
    identifier: `YU-${number}`,
    title: `Linear issue ${number}`,
    url: `https://linear.app/yu/issue/YU-${number}/linear-issue`,
    state: { id: "state", name: "Open", type: "unstarted", color: "#000000" },
  },
  selection: {
    text: `Linear words ${number}`,
    origin: "body",
    comment: "Linear note",
  },
});
const acknowledged = (updateId: string) => ({
  _meta: { "openai/modelContext": { updateId } },
});
function changed(change: Record<string, unknown>) {
  fixture.context = { ...fixture.context, ...change };
  fixture.change!(change);
}
function deferred() {
  let resolve!: (result: Record<string, unknown>) => void;
  const promise = new Promise<Record<string, unknown>>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

beforeEach(() => {
  fixture.modelContextSupported = true;
  fixture.context = { "openai/modelContext": null };
  fixture.change = undefined;
  fixture.toolResult = undefined;
  fixture.connecting = undefined;
  fixture.display.mockReset();
  fixture.display.mockImplementation(async (params) => params);
  fixture.update.mockReset();
  fixture.call.mockReset();
});

describe("host launch context", () => {
  const projectLaunch: LaunchContext = {
    view: "project",
    repo: "yu/Arco",
    projectKey: "a".repeat(64),
    projectName: "Arco",
    candidates: ["yu/Arco"],
    reason: "detected",
  };

  it.each(["inline", "fullscreen", "pip"])(
    "waits for the global result and opens personal regardless of %s display mode",
    async (displayMode) => {
      fixture.context = {
        "openai/modelContext": null,
        toolInfo: { tool: { name: "arco_open" } },
        displayMode,
      };
      const host = await connectHost();
      expect(host.launch?.()).toBeNull();
      fixture.toolResult!({
        structuredContent: { launch: personalLaunchContext },
      });
      expect(host.launch?.()).toEqual(personalLaunchContext);
      fixture.toolResult!({ structuredContent: { launch: projectLaunch } });
      expect(host.launch?.()).toEqual(personalLaunchContext);
    },
  );

  it("waits for a validated delayed project launch and keeps it through later tool and presentation updates", async () => {
    fixture.context = {
      "openai/modelContext": null,
      toolInfo: { tool: { name: "arco_open_project" } },
      displayMode: "inline",
    };
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    expect(host.launch?.()).toBeNull();
    fixture.toolResult!({ structuredContent: { issues: [] } });
    fixture.toolResult!({
      structuredContent: { launch: { ...projectLaunch, repo: "../settings" } },
    });
    fixture.toolResult!({
      isError: true,
      structuredContent: { launch: projectLaunch },
    });
    expect(host.launch?.()).toBeNull();
    expect(host.launchError?.()).toBeTruthy();
    expect(events).toEqual(["launch"]);

    fixture.toolResult!({ structuredContent: { launch: projectLaunch } });
    expect(host.launch?.()).toEqual(projectLaunch);
    expect(host.launchError?.()).toBeNull();
    expect(events).toEqual(["launch", "launch"]);
    fixture.toolResult!({
      structuredContent: {
        launch: { ...projectLaunch, repo: "yu/Other" },
        issue: { repo: "yu/Other", number: 2 },
      },
    });
    fixture.toolResult!({
      structuredContent: { launch: personalLaunchContext },
    });
    changed({ theme: "dark", displayMode: "fullscreen" });
    changed({ toolInfo: { tool: { name: "arco_open" } } });
    expect(host.launch?.()).toEqual(projectLaunch);
    expect(events).toEqual(["launch", "launch", "display"]);
  });

  it("registers the launch receiver before connecting and does not infer project scope from fullscreen", async () => {
    fixture.context = {
      "openai/modelContext": null,
      displayMode: "fullscreen",
    };
    fixture.connecting = () => {
      expect(fixture.toolResult).toBeTypeOf("function");
      fixture.toolResult!({ structuredContent: { launch: projectLaunch } });
    };
    const host = await connectHost();
    expect(host.launch?.()).toEqual(projectLaunch);
  });

  it("waits for the global result when tool information arrives after connecting", async () => {
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    expect(host.launch?.()).toBeNull();
    changed({ displayMode: "fullscreen", theme: "light" });
    expect(host.launch?.()).toBeNull();
    changed({ toolInfo: { tool: { name: "arco_open" } } });
    expect(host.launch?.()).toBeNull();
    expect(events).toEqual(["display"]);
    fixture.toolResult!({
      structuredContent: { launch: personalLaunchContext },
    });
    expect(host.launch?.()).toEqual(personalLaunchContext);
    expect(events).toEqual(["display", "launch"]);
  });

  it.each([
    {
      tool: "arco_show_issue",
      displayMode: "inline",
      target: { source: "github" as const, repo: "yu/Target", number: 42 },
    },
    {
      tool: "arco_open_issue",
      displayMode: "fullscreen",
      target: {
        source: "linear" as const,
        connectionId: "secondary",
        workspaceId: "target-workspace",
        teamId: "target-team",
        issueId: "target-issue",
      },
    },
  ])(
    "latches $tool target without changing shared context or host display mode",
    async ({ tool, displayMode, target }) => {
      fixture.context = {
        "openai/modelContext": {
          updateId: "shared-other-issue",
          structuredContent: {
            source: "github",
            repo: "yu/Shared",
            number: 7,
            arcoSharedIssue: 1,
          },
        },
        toolInfo: { tool: { name: tool } },
        displayMode,
      };
      const launch = { ...personalLaunchContext, target };
      fixture.connecting = () => {
        fixture.toolResult!({ structuredContent: { launch } });
      };
      const host = await connectHost();
      expect(host.launch?.()).toEqual(launch);
      expect(host.mode()).toBe(displayMode);
      expect(host.sharedIssue?.()).toEqual({
        source: "github",
        repo: "yu/Shared",
        number: 7,
      });
      fixture.toolResult!({
        structuredContent: {
          launch: {
            ...personalLaunchContext,
            target: { source: "github", repo: "yu/Later", number: 99 },
          },
        },
      });
      expect(host.launch?.()).toEqual(launch);
      expect(fixture.update).not.toHaveBeenCalled();
      expect(fixture.display).not.toHaveBeenCalled();
    },
  );

  it("retains a grouped issue launch through detail display changes and later tool results", async () => {
    fixture.context = {
      "openai/modelContext": null,
      toolInfo: { tool: { name: "arco_show_issues" } },
      displayMode: "inline",
    };
    const launch = {
      ...personalLaunchContext,
      issues: [
        {
          source: "github",
          repo: "yu/Arco",
          number: 42,
          id: "fixture-issue-42",
          title: "GitHub issue",
          url: "https://github.com/yu/Arco/issues/42",
          state: "open",
          stateReason: null,
        },
        {
          source: "linear",
          connectionId: "default",
          workspaceId: "workspace",
          teamId: "team",
          issueId: "linear-issue",
          identifier: "YU-43",
          title: "Linear issue",
          url: "https://linear.app/yu/issue/YU-43",
          state: {
            id: "state",
            name: "In Progress",
            type: "started",
            color: "#f2c94c",
          },
        },
      ],
    };
    fixture.connecting = () => {
      fixture.toolResult!({ structuredContent: { launch } });
    };
    const host = await connectHost();
    expect(host.launch()).toEqual(launch);
    changed({ displayMode: "fullscreen" });
    fixture.toolResult!({
      structuredContent: {
        launch: {
          ...personalLaunchContext,
          target: { source: "github", repo: "yu/Other", number: 99 },
        },
      },
    });
    changed({ displayMode: "inline" });
    expect(host.launch()).toEqual(launch);
    expect(host.mode()).toBe("inline");
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.display).not.toHaveBeenCalled();
  });

  it.each(["arco_open", "arco_open_project"])(
    "does not retarget an existing %s panel from a later issue-show result",
    async (tool) => {
      fixture.context = {
        "openai/modelContext": null,
        toolInfo: { tool: { name: tool } },
        displayMode: "fullscreen",
      };
      fixture.connecting = () =>
        fixture.toolResult!({
          structuredContent: {
            launch:
              tool === "arco_open_project"
                ? projectLaunch
                : personalLaunchContext,
          },
        });
      const host = await connectHost();
      const initial = host.launch?.();
      fixture.toolResult!({
        structuredContent: {
          launch: {
            ...personalLaunchContext,
            target: { source: "github", repo: "yu/Other", number: 88 },
          },
        },
      });
      expect(host.launch?.()).toEqual(initial);
      expect(host.mode()).toBe("fullscreen");
      expect(fixture.update).not.toHaveBeenCalled();
      expect(fixture.display).not.toHaveBeenCalled();
    },
  );

  it.each([
    { source: "github" as const, displayMode: "inline" },
    { source: "github" as const, displayMode: "fullscreen" },
    { source: "linear" as const, displayMode: "inline" },
    { source: "linear" as const, displayMode: "fullscreen" },
  ])(
    "uses the first validated $source list launch in $displayMode mode without a context-name fallback",
    async ({ source, displayMode }) => {
      fixture.context = {
        "openai/modelContext": null,
        toolInfo: { tool: { name: "arco_open" } },
        displayMode,
      };
      const host = await connectHost();
      expect(host.launch?.()).toBeNull();
      const launch = { ...personalLaunchContext, source };
      fixture.toolResult!({ structuredContent: { launch } });
      expect(host.launch?.()).toEqual(launch);
      changed({ toolInfo: { tool: { name: "arco_open" } } });
      fixture.toolResult!({
        structuredContent: {
          launch: {
            ...personalLaunchContext,
            source: source === "github" ? "linear" : "github",
          },
        },
      });
      fixture.toolResult!({
        structuredContent: { launch: personalLaunchContext },
      });
      expect(host.launch?.()).toEqual(launch);
      expect(host.mode()).toBe(displayMode);
      expect(fixture.update).not.toHaveBeenCalled();
      expect(fixture.display).not.toHaveBeenCalled();
    },
  );

  it("reports an initial tool failure without accepting its target and recovers only from a valid launch", async () => {
    fixture.context = {
      "openai/modelContext": null,
      toolInfo: { tool: { name: "arco_show_issue" } },
      displayMode: "inline",
    };
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    const launch = {
      ...personalLaunchContext,
      target: { source: "github", repo: "yu/Target", number: 42 },
    };
    fixture.toolResult!({ isError: true, structuredContent: { launch } });
    expect(host.launch?.()).toBeNull();
    expect(host.launchError?.()).toContain("invalid error response");
    fixture.toolResult!({
      structuredContent: {
        launch: {
          ...launch,
          target: { source: "github", repo: "../bad", number: 42 },
        },
      },
    });
    expect(host.launch?.()).toBeNull();
    expect(host.launchError?.()).toBeTruthy();
    fixture.toolResult!({ structuredContent: { launch } });
    expect(host.launch?.()).toEqual(launch);
    expect(host.launchError?.()).toBeNull();
    fixture.toolResult!({ isError: true });
    expect(host.launch?.()).toEqual(launch);
    expect(host.launchError?.()).toBeNull();
    expect(events).toEqual(["launch", "launch"]);
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.display).not.toHaveBeenCalled();
  });
});

describe("host operation failures", () => {
  it.each([
    ["auth", "Reconnect the source account"],
    ["forbidden", "Check your access"],
    ["rate-limited", "Wait for the source's API limit"],
    ["uncertain", "Check the result in the source"],
  ] as const)(
    "preserves %s and its next action without retrying the operation",
    async (kind, action) => {
      fixture.call.mockResolvedValue(toolFailure("A safe source error.", kind));
      const host = await connectHost();
      await expect(
        host.call("arco_comment", { requestId: "unchanged-id" }),
      ).rejects.toMatchObject({
        name: "ToolCallError",
        kind,
        detail: "A safe source error.",
        message: expect.stringContaining(action),
      });
      expect(fixture.call).toHaveBeenCalledExactlyOnceWith({
        name: "arco_comment",
        arguments: { requestId: "unchanged-id" },
      });
    },
  );

  it("rejects a text-only server error instead of accepting an obsolete or malformed result", async () => {
    fixture.call.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "untrusted server error secret-token" }],
    });
    const host = await connectHost();
    const error = await host
      .call("arco_get_issue", {})
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ToolCallError);
    expect(error).toMatchObject({ kind: "invalid-response" });
    expect((error as Error).message).not.toContain("secret-token");
    expect(fixture.call).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["arco_get_issue", {}, "unavailable", "Check the connection and refresh"],
    [
      "arco_comment",
      { requestId: "same-id" },
      "uncertain",
      "Check the result in the source",
    ],
  ] as const)(
    "classifies a rejected %s transport without exposing it or resending",
    async (name, args, kind, action) => {
      fixture.call.mockRejectedValue(
        new Error("private subprocess output secret-token"),
      );
      const host = await connectHost();
      const error = await host
        .call(name, args)
        .catch((error: unknown) => error);
      expect(error).toMatchObject({ kind });
      expect((error as Error).message).toContain(action);
      expect((error as Error).message).not.toContain("secret-token");
      expect(fixture.call).toHaveBeenCalledTimes(1);
    },
  );

  it("uses the same source failure contract for image requests", async () => {
    fixture.call.mockResolvedValue(
      toolFailure("Image permission denied.", "forbidden"),
    );
    const host = await connectHost();
    await expect(
      host.readImage(
        { source: "github", repo: "yu/Arco", number: 42 } as Parameters<
          typeof host.readImage
        >[0],
        "https://example.com/source.png",
      ),
    ).rejects.toMatchObject({
      kind: "forbidden",
      message: expect.stringContaining("Check your access"),
    });
    expect(fixture.call).toHaveBeenCalledTimes(1);
  });
});

describe("host attachment context lifecycle", () => {
  it("refuses sharing without synchronized model context support and leaves the attachment unchanged", async () => {
    fixture.modelContextSupported = false;
    fixture.update.mockResolvedValue({});
    const host = await connectHost();
    await expect(host.shareAnnotations([annotationFor(1)])).rejects.toThrow(
      "does not support synchronized context attachments",
    );
    expect(fixture.update).not.toHaveBeenCalled();
    expect(host.sharedAnnotations()).toBeNull();
    expect(host.sharedIssue()).toBeNull();
  });

  it("applies the native attachment as one snapshot and ignores unsupported selection-only context", async () => {
    const host = await connectHost();
    const observed: unknown[] = [];
    host.subscribe((event) => {
      if (event === "context")
        observed.push({
          issue: host.sharedIssue?.(),
          annotations: host.sharedAnnotations?.(),
          snapshotId: host.annotationSnapshotId?.(),
        });
    });
    const annotation = annotationFor(1);
    const id = "d849445f-dbf3-4988-847b-81d2966dc0a2";
    changed({
      "openai/modelContext": {
        updateId: "native-current",
        structuredContent: {
          ...annotation.issue,
          arcoSharedIssue: 1,
          selection: annotation.selection,
          annotations: [annotation],
          arcoAnnotationSnapshotId: id,
        },
      },
    });
    changed({
      "openai/modelContext": {
        updateId: "unsupported-selection-only",
        structuredContent: {
          ...annotation.issue,
          arcoSharedIssue: 1,
          selection: annotation.selection,
          arcoAnnotationSnapshotId: id,
        },
      },
    });
    expect(observed).toEqual([
      {
        issue: { source: "github", repo: "yu/Arco", number: 1 },
        annotations: [annotation],
        snapshotId: id,
      },
      { issue: null, annotations: null, snapshotId: null },
    ]);
  });

  it("keeps an opaque position ID through a recreated view and clears it with native attachment removal", async () => {
    fixture.update.mockResolvedValue(acknowledged("with-positions"));
    const id = "d849445f-dbf3-4988-847b-81d2966dc0a2";
    const host = await connectHost();
    await host.shareAnnotations([annotationFor(1)], id);
    const params = fixture.update.mock.calls[0][0];
    expect(params.structuredContent).toMatchObject({
      arcoAnnotationSnapshotId: id,
    });
    expect(host.annotationSnapshotId?.()).toBe(id);
    fixture.context = {
      "openai/modelContext": { ...params, updateId: "with-positions" },
    };
    const restored = await connectHost();
    expect(restored.annotationSnapshotId?.()).toBe(id);
    expect(restored.sharedAnnotations?.()).toEqual([annotationFor(1)]);
    changed({ "openai/modelContext": null });
    expect(restored.annotationSnapshotId?.()).toBeNull();
    expect(restored.sharedAnnotations?.()).toBeNull();
    await expect(
      restored.shareAnnotations([annotationFor(1)], "../settings"),
    ).rejects.toThrow();
    expect(fixture.update).toHaveBeenCalledTimes(1);
  });
  it("removes acknowledged context without requiring an echo and ignores presentation changes", async () => {
    fixture.update.mockResolvedValue(acknowledged("own-update"));
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    await host.shareAnnotations([annotationFor(1)]);
    expect(host.sharedIssue?.()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 1,
    });
    expect(host.sharedAnnotations?.()).toEqual([annotationFor(1)]);
    changed({ theme: "dark", containerDimensions: { width: 390 } });
    expect(host.sharedIssue?.()?.source).toBe("github");
    expect(events).toEqual(["context"]);
    changed({ "openai/modelContext": null });
    expect(host.sharedIssue?.()).toBeNull();
    expect(host.sharedAnnotations?.()).toBeNull();
    expect(events).toEqual(["context", "context"]);

    const params = fixture.update.mock.calls[0]![0];
    expect(params.structuredContent).toMatchObject({
      source: "github",
      number: 1,
      selection: { text: "Selected words 1", origin: "ui" },
      arcoSharedIssue: 1,
      annotations: [annotationFor(1)],
    });
    expect(params.structuredContent).not.toHaveProperty("body");
    expect(params.content).toEqual([
      {
        type: "text",
        text: "1. yu/Arco #1\nSelected words 1",
        _meta: {
          "openai/title": "#1 Selected words 1",
          "openai/group": { title: "1 annotation" },
        },
      },
      expect.objectContaining({
        type: "text",
        annotations: { audience: ["assistant"] },
        _meta: { "openai/group": { title: "1 annotation" } },
      }),
    ]);
  });

  it("groups separate numbered GitHub and Linear items and edits one note without replacing the other annotation", async () => {
    fixture.update.mockResolvedValue(acknowledged("collection"));
    const host = await connectHost();
    const github = annotationFor(1, "GitHub note");
    const linear = linearAnnotation(2);
    await host.shareAnnotations([github, linear]);
    expect(host.sharedIssue?.()).toBeNull();
    expect(host.sharedAnnotations?.()).toEqual([github, linear]);
    const first = fixture.update.mock.calls[0]![0];
    expect(first.structuredContent).toEqual({
      source: "arco",
      annotations: [github, linear],
    });
    const content = first.content as { text: string }[];
    expect(content).toEqual([
      {
        type: "text",
        text: "1. yu/Arco #1\nSelected words 1\n\nComment: GitHub note",
        _meta: {
          "openai/title": "#1 Selected words 1",
          "openai/group": { title: "2 annotations" },
        },
      },
      {
        type: "text",
        text: "2. YU-2\nLinear words 2\n\nComment: Linear note",
        _meta: {
          "openai/title": "#2 Linear words 2",
          "openai/group": { title: "2 annotations" },
        },
      },
      expect.objectContaining({
        type: "text",
        annotations: { audience: ["assistant"] },
        _meta: { "openai/group": { title: "2 annotations" } },
      }),
    ]);
    expect(
      JSON.parse(
        content[2]!.text.slice("Issue context (source data):\n".length),
      ),
    ).toEqual(first.structuredContent);
    expect(first.structuredContent).not.toHaveProperty("selection");
    expect(first.structuredContent).not.toHaveProperty("body");
    const edited = annotationFor(1, "Edited GitHub note");
    await host.shareAnnotations([edited, linear]);
    expect(host.sharedAnnotations?.()).toEqual([edited, linear]);
    const saved = fixture.update.mock.calls[1]![0].structuredContent;
    expect(saved).toEqual({ source: "arco", annotations: [edited, linear] });
    fixture.context = {
      "openai/modelContext": {
        updateId: "restored-collection",
        structuredContent: saved,
      },
    };
    const restored = await connectHost();
    expect(restored.sharedAnnotations?.()).toEqual([edited, linear]);
    expect(restored.sharedIssue?.()).toBeNull();
  });

  it("shortens only the annotation title while preserving the complete selected text", async () => {
    fixture.update.mockResolvedValue(acknowledged("long-selection"));
    const host = await connectHost();
    const annotation = annotationFor(1);
    annotation.selection.text = `  Preserve\n\t${"x".repeat(80)}  `;
    await host.shareAnnotations([annotation]);
    const params = fixture.update.mock.calls[0]![0];
    const content = params.content as { text: string }[];
    expect(content[0]).toEqual({
      type: "text",
      text: `1. yu/Arco #1\n${annotation.selection.text}`,
      _meta: {
        "openai/title": `#1 Preserve ${"x".repeat(55)}…`,
        "openai/group": { title: "1 annotation" },
      },
    });
    expect(params.structuredContent).toMatchObject({
      selection: annotation.selection,
      annotations: [annotation],
    });
  });

  it("clears the last annotation with empty content and rejects invalid or duplicate numbers before sending", async () => {
    fixture.update.mockResolvedValue(acknowledged("own-update"));
    const host = await connectHost();
    for (const annotations of [
      [{ ...annotationFor(1), number: 0 }],
      [{ ...annotationFor(1), number: 1.5 }],
      [annotationFor(1), annotationFor(1)],
    ])
      await expect(host.shareAnnotations(annotations)).rejects.toThrow(
        "unique positive numbers",
      );
    expect(fixture.update).not.toHaveBeenCalled();
    await host.shareAnnotations([annotationFor(1)]);
    await host.shareAnnotations([]);
    expect(fixture.update.mock.calls.at(-1)![0]).toEqual({
      content: [],
      structuredContent: { source: "arco", annotations: [] },
    });
    expect(host.sharedAnnotations?.()).toEqual([]);
    expect(host.sharedIssue?.()).toBeNull();
  });

  it("does not restore a pending collection after a native removal", async () => {
    const saved = [annotationFor(1), linearAnnotation(2)];
    fixture.context = {
      "openai/modelContext": {
        updateId: "existing-collection",
        structuredContent: { source: "arco", annotations: saved },
      },
    };
    const pending = deferred();
    fixture.update.mockReturnValue(pending.promise);
    const host = await connectHost();
    expect(host.sharedAnnotations?.()).toEqual(saved);
    const editing = host.shareAnnotations([
      annotationFor(1, "Pending edit"),
      saved[1]!,
    ]);
    changed({ "openai/modelContext": null });
    pending.resolve(acknowledged("pending-edit"));
    await editing;
    expect(host.sharedAnnotations?.()).toBeNull();
    expect(host.sharedIssue?.()).toBeNull();
  });

  it("keeps the optional user comment separate from source selection text in the visible and structured attachment", async () => {
    fixture.update.mockResolvedValue(acknowledged("commented-selection"));
    const host = await connectHost();
    const context = annotationFor(
      1,
      "Explain this paragraph.\nKeep the native ID.",
    );
    await host.shareAnnotations([context]);
    expect(host.sharedAnnotations?.()).toEqual([context]);
    const params = fixture.update.mock.calls[0]![0];
    const content = params.content as { text: string }[];
    expect(content[0]!.text).toBe(
      "1. yu/Arco #1\nSelected words 1\n\nComment: Explain this paragraph.\nKeep the native ID.",
    );
    const hidden = JSON.parse(
      content[1]!.text.slice("Issue context (source data):\n".length),
    );
    expect(hidden.selection).toEqual(context.selection);
    expect(params.structuredContent).toMatchObject({
      selection: {
        text: "Selected words 1",
        comment: "Explain this paragraph.\nKeep the native ID.",
      },
    });
    expect(hidden).not.toHaveProperty("body");
    changed({ "openai/modelContext": null });
    expect(host.sharedAnnotations?.()).toBeNull();
  });

  it("restores a native selected comment and clears it when replaced by whole-Issue context", async () => {
    const selection = {
      text: "Original comment fragment",
      origin: "comment" as const,
      commentId: "native-comment",
      comment: "My separate question",
    };
    const issue: NonNullable<SelectionAnnotationContext["issue"]> = {
      source: "linear",
      connectionId: "default",
      workspaceId: "workspace",
      teamId: "team",
      id: "native-issue",
      identifier: "YU-1",
      title: "Native issue",
      url: "https://linear.app/yu/issue/YU-1/native-issue",
      state: { id: "state", name: "Open", type: "unstarted", color: "#000000" },
    };
    fixture.context = {
      "openai/modelContext": {
        updateId: "restored-selection",
        structuredContent: {
          ...issue,
          arcoSharedIssue: 1,
          selection,
          annotations: [{ number: 1, issue, selection }],
        },
      },
    };
    const host = await connectHost();
    expect(host.sharedAnnotations?.()).toEqual([
      { number: 1, issue, selection },
    ]);
    changed({
      "openai/modelContext": {
        updateId: "whole-issue",
        structuredContent: {
          source: "github",
          repo: "yu/Arco",
          number: 2,
          arcoSharedIssue: 1,
        },
      },
    });
    expect(host.sharedAnnotations?.()).toBeNull();
    expect(host.sharedIssue?.()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 2,
    });
  });

  it("ignores unchanged model context included in presentation snapshots, including while awaiting an ACK", async () => {
    const pending = deferred();
    fixture.update.mockReturnValue(pending.promise);
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    const sharing = host.shareAnnotations([annotationFor(1)]);
    changed({
      theme: "light",
      containerDimensions: { width: 390 },
      "openai/modelContext": null,
    });
    expect(events).toEqual([]);
    pending.resolve(acknowledged("own-update"));
    await sharing;
    const echoed = {
      updateId: "own-update",
      structuredContent: fixture.update.mock.calls[0]![0].structuredContent,
    };
    changed({ "openai/modelContext": echoed });
    changed({
      theme: "dark",
      containerDimensions: { width: 1200 },
      "openai/modelContext": echoed,
    });
    changed({ "openai/modelContext": echoed });
    expect(events).toEqual(["context"]);
    expect(host.sharedIssue?.()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 1,
    });
  });

  it("reports an unconfirmed attachment instead of applying a local success without ACK metadata", async () => {
    fixture.update.mockResolvedValue({});
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    await expect(
      host.shareAnnotations([
        { number: 1, selection: { text: "Arco", origin: "ui" } },
      ]),
    ).rejects.toThrow("did not confirm the context attachment");
    expect(host.sharedIssue?.()).toBeNull();
    expect(host.sharedAnnotations()).toBeNull();
    changed({ "openai/modelContext": null });
    expect(host.sharedAnnotations?.()).toBeNull();
    expect(events).toEqual([]);
    changed({ theme: "dark", "openai/modelContext": null });
    expect(events).toEqual([]);
  });

  it.each([
    null,
    {
      updateId: "native-replacement",
      structuredContent: {
        source: "github",
        repo: "yu/Arco",
        number: 2,
        arcoSharedIssue: 1,
      },
    },
    {
      updateId: "native-selection-replacement",
      structuredContent: {
        ...annotationFor(2).issue,
        arcoSharedIssue: 1,
        selection: annotationFor(1).selection,
        annotations: [{ ...annotationFor(1), issue: annotationFor(2).issue }],
      },
    },
  ])(
    "keeps a native removal or replacement received before the ACK: %j",
    async (native) => {
      const pending = deferred();
      fixture.update.mockReturnValue(pending.promise);
      const host = await connectHost();
      const events: string[] = [];
      host.subscribe((event) => events.push(event));
      const sharing = host.shareAnnotations([annotationFor(1)]);
      changed({ "openai/modelContext": native });
      pending.resolve(acknowledged("own-update"));
      await sharing;
      expect(host.sharedIssue?.()).toEqual(
        native ? { source: "github", repo: "yu/Arco", number: 2 } : null,
      );
      expect(host.sharedAnnotations?.()).toEqual(
        native && "selection" in native.structuredContent
          ? [
              {
                number: 1,
                issue: annotationFor(2).issue,
                selection: annotationFor(1).selection,
              },
            ]
          : null,
      );
      expect(events).toEqual(["context"]);
    },
  );

  it("accepts its own echo before the ACK and refuses concurrent attachment writes until explicit retry", async () => {
    const pending = deferred();
    fixture.update.mockReturnValueOnce(pending.promise);
    const host = await connectHost();
    const original = annotationFor(1, "Keep this note through its ACK");
    const first = host.shareAnnotations([original]);
    await expect(host.shareAnnotations([annotationFor(2)])).rejects.toThrow(
      "Wait for the current attachment to finish",
    );
    expect(fixture.update).toHaveBeenCalledTimes(1);
    changed({
      "openai/modelContext": {
        updateId: "own-update",
        structuredContent: fixture.update.mock.calls[0]![0].structuredContent,
      },
    });
    pending.resolve(acknowledged("own-update"));
    await first;
    expect(host.sharedIssue?.()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 1,
    });
    expect(host.sharedAnnotations?.()).toEqual([original]);
    const revised = annotationFor(1, "A different note on the same words");
    changed({
      "openai/modelContext": {
        updateId: "native-edited-note",
        structuredContent: {
          ...revised.issue,
          arcoSharedIssue: 1,
          selection: revised.selection,
          annotations: [revised],
        },
      },
    });
    expect(host.sharedAnnotations?.()).toEqual([revised]);
    fixture.update.mockResolvedValueOnce(acknowledged("explicit-retry"));
    await host.shareAnnotations([annotationFor(2)]);
    expect(fixture.update).toHaveBeenCalledTimes(2);
    expect(host.sharedIssue?.()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 2,
    });
    expect(host.sharedAnnotations?.()).toEqual([annotationFor(2)]);
  });

  it("releases a rejected attachment without replacing context or retrying automatically", async () => {
    fixture.update.mockRejectedValueOnce(new Error("Host rejected attachment"));
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    await expect(host.shareAnnotations([annotationFor(1)])).rejects.toThrow(
      "Host rejected attachment",
    );
    expect(host.sharedIssue?.()).toBeNull();
    expect(host.sharedAnnotations?.()).toBeNull();
    expect(events).toEqual([]);
    expect(fixture.update).toHaveBeenCalledTimes(1);
    fixture.update.mockResolvedValueOnce(acknowledged("explicit-retry"));
    await host.shareAnnotations([annotationFor(1)]);
    expect(fixture.update).toHaveBeenCalledTimes(2);
    expect(events).toEqual(["context"]);
  });
});
