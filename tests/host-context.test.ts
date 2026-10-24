import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionAnnotationContext } from "../src/shared/contracts";
import {
  personalLaunchContext,
  type LaunchContext,
} from "../src/shared/launch";
import { connectHost } from "../src/ui/host";

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
  fixture.update.mockReset();
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
    "opens the global tool as personal regardless of %s display mode",
    async (displayMode) => {
      fixture.context = {
        "openai/modelContext": null,
        toolInfo: { tool: { name: "arco_open" } },
        displayMode,
      };
      const host = await connectHost();
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
    expect(events).toEqual([]);

    fixture.toolResult!({ structuredContent: { launch: projectLaunch } });
    expect(host.launch?.()).toEqual(projectLaunch);
    expect(events).toEqual(["launch"]);
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
    expect(events).toEqual(["launch", "display"]);
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

  it("can recognize the global entrypoint when tool information arrives after connecting", async () => {
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    expect(host.launch?.()).toBeNull();
    changed({ displayMode: "fullscreen", theme: "light" });
    expect(host.launch?.()).toBeNull();
    changed({ toolInfo: { tool: { name: "arco_open" } } });
    expect(host.launch?.()).toEqual(personalLaunchContext);
    expect(events).toEqual(["display", "launch"]);
  });
});

describe("host attachment context lifecycle", () => {
  it("uses standard model context updates when the optional extension is not advertised", async () => {
    fixture.modelContextSupported = false;
    fixture.update.mockResolvedValue({});
    const host = await connectHost();
    await host.shareAnnotations([annotationFor(1)]);
    expect(fixture.update).toHaveBeenCalledOnce();
    expect(host.sharedAnnotations?.()).toEqual([annotationFor(1)]);
    expect(host.sharedIssue?.()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 1,
    });
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
  it.each([
    { label: "with an update ID", result: acknowledged("own-update") },
    { label: "without ACK metadata", result: {} },
  ])(
    "removes acknowledged context $label without requiring an echo and ignores presentation changes",
    async ({ result }) => {
      fixture.update.mockResolvedValue(result);
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
    },
  );

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

  it("clears a generic selection without ACK metadata even though it has no native Issue ref", async () => {
    fixture.update.mockResolvedValue({});
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    await host.shareAnnotations([
      { number: 1, selection: { text: "Arco", origin: "ui" } },
    ]);
    expect(host.sharedIssue?.()).toBeNull();
    expect(host.sharedAnnotations?.()).toEqual([
      { number: 1, selection: { text: "Arco", origin: "ui" } },
    ]);
    changed({ "openai/modelContext": null });
    expect(host.sharedAnnotations?.()).toBeNull();
    expect(events).toEqual(["context", "context"]);
    changed({ theme: "dark", "openai/modelContext": null });
    expect(events).toEqual(["context", "context"]);
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
