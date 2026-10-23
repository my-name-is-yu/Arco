import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionAnnotationContext } from "../src/shared/contracts";
import { connectHost } from "../src/ui/host";

const fixture = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  change: undefined as ((change: Record<string, unknown>) => void) | undefined,
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
      return { experimental: { "openai/modelContext": {} } };
    }
    set onhostcontextchanged(handler: typeof fixture.change) {
      fixture.change = handler;
    }
    connect = async () => undefined;
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
  fixture.context = { "openai/modelContext": null };
  fixture.change = undefined;
  fixture.update.mockReset();
});

describe("host attachment context lifecycle", () => {
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
