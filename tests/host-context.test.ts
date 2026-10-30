import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionAnnotationContext } from "../src/shared/contracts";
import {
  issuePresentationSummarySchema,
  personalLaunchContext,
  type LaunchContext,
} from "../src/shared/launch";
import { connectHost } from "../src/ui/host";
import { annotationAttachment } from "../src/ui/context-attachment";
import { ToolCallError } from "../src/shared/errors";
import { toolFailure } from "./tool-failure";
import { createFixtureService } from "../src/server/fixture";
import type { LinearIssue } from "../src/shared/linear";
import {
  createLinearFixtureService,
  LINEAR_FIXTURE_SCOPE,
} from "../src/server/linear/fixture";

const fixture = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  modelContextSupported: true,
  change: undefined as ((change: Record<string, unknown>) => void) | undefined,
  toolResult: undefined as
    | ((result: {
        structuredContent?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
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

async function issuePresentation() {
  const github = await createFixtureService().get({
    repo: "yu/Arco",
    number: 42,
  });
  const linear = (await createLinearFixtureService().call("linear_get_issue", {
    ...LINEAR_FIXTURE_SCOPE,
    issueId: "fixture-linear-42",
  })) as LinearIssue;
  const issueDetails = [github, linear];
  return {
    structuredContent: {
      launch: {
        ...personalLaunchContext,
        issues: issueDetails.map((issue) =>
          issuePresentationSummarySchema.options[
            issue.source === "github" ? 0 : 1
          ]
            .strip()
            .parse(issue),
        ),
      },
    },
    _meta: { issueDetails },
  };
}

function presentationTargets(
  response: Awaited<ReturnType<typeof issuePresentation>>,
) {
  return response._meta.issueDetails.map((issue) =>
    issue.source === "github"
      ? { source: issue.source, repo: issue.repo, number: issue.number }
      : {
          source: issue.source,
          connectionId: issue.connectionId,
          workspaceId: issue.workspaceId,
          teamId: issue.teamId,
          issueId: issue.issueId,
        },
  );
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

  it("retains all app-only issue details before publishing the grouped launch", async () => {
    const response = await issuePresentation();
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => {
      events.push(event);
      if (event === "launch")
        expect(host.presentationIssues?.()?.issues).toEqual(
          response._meta.issueDetails,
        );
    });
    expect(host.presentationIssues?.()).toBeNull();
    fixture.toolResult!(response);
    expect(host.launch()).toEqual(response.structuredContent.launch);
    expect(host.presentationIssues?.()).toEqual({
      issues: response._meta.issueDetails,
      receivedAt: expect.any(Number),
    });
    expect(events).toEqual(["launch"]);
    expect(response.structuredContent.launch.issues[0]).not.toHaveProperty(
      "body",
    );
    fixture.toolResult!({ structuredContent: { launch: projectLaunch } });
    expect(host.presentationIssues?.()?.issues).toEqual(
      response._meta.issueDetails,
    );
  });

  it("updates app-only details during a group refresh without replacing the original launch", async () => {
    const response = await issuePresentation();
    fixture.connecting = () => fixture.toolResult!(response);
    const host = await connectHost();
    const refreshed = await issuePresentation();
    refreshed._meta.issueDetails[0].body = "An externally updated description";
    fixture.call.mockResolvedValue(refreshed);
    const data = await host.call("arco_show_issues", {
      targets: presentationTargets(response),
    });
    expect(data).toEqual({
      ...refreshed.structuredContent,
      presentation: host.presentationIssues?.(),
    });
    expect(host.presentationIssues?.()?.issues[0].body).toBe(
      "An externally updated description",
    );
    expect(host.launch()).toEqual(response.structuredContent.launch);
  });

  it("preserves the original snapshot when a refresh returns a different self-consistent group", async () => {
    const response = await issuePresentation();
    fixture.connecting = () => fixture.toolResult!(response);
    const host = await connectHost();
    const original = host.presentationIssues?.();
    const different = await issuePresentation();
    different._meta.issueDetails.reverse();
    different.structuredContent.launch.issues.reverse();
    fixture.call.mockResolvedValue(different);
    await expect(
      host.call("arco_show_issues", {
        targets: presentationTargets(response),
      }),
    ).rejects.toMatchObject({ kind: "invalid-response" });
    expect(host.presentationIssues?.()).toBe(original);
    expect(host.launch()).toEqual(response.structuredContent.launch);
  });

  it.each(["identity", "body", "count"])(
    "rejects invalid app-only %s data before exposing the launch",
    async (invalid) => {
      const response = await issuePresentation();
      if (invalid === "identity") response._meta.issueDetails.reverse();
      else if (invalid === "body")
        Object.assign(response._meta.issueDetails[0], { body: undefined });
      else response._meta.issueDetails.pop();
      const host = await connectHost();
      fixture.toolResult!(response);
      expect(host.launch()).toBeNull();
      expect(host.presentationIssues?.()).toBeNull();
      expect(host.launchError()).toContain("invalid issue details");
    },
  );

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
    expect(host.launchError?.()).toBe(
      "Could not read the result. Reopen Arco and try again.",
    );
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
    ["auth", "Your authorization expired. Reconnect to Linear."],
    ["forbidden", "Permission denied. Check your access to this issue."],
    ["rate-limited", "Requests are temporarily limited. Wait and refresh."],
    [
      "uncertain",
      "The change was not confirmed. Check the result in the source and refresh before submitting this change again.",
    ],
  ] as const)(
    "preserves %s and its next action without retrying the operation",
    async (kind, detail) => {
      fixture.call.mockResolvedValue(toolFailure(detail, kind));
      const host = await connectHost();
      await expect(
        host.call("arco_comment", { requestId: "unchanged-id" }),
      ).rejects.toMatchObject({
        name: "ToolCallError",
        kind,
        detail,
        message: detail,
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
    ["arco_get_issue", {}, "unavailable", "Refresh and try again"],
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
      toolFailure(
        "Image permission denied. Check your access to this image.",
        "forbidden",
      ),
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

  it("rejects malformed issue presentation data without schema details or a retry", async () => {
    fixture.call.mockResolvedValue({
      structuredContent: { launch: { view: "private-schema-value" } },
    });
    const host = await connectHost();
    await expect(
      host.call("arco_show_issues", { targets: [] }),
    ).rejects.toMatchObject({
      kind: "invalid-response",
      message: "Could not load these issues. Refresh and try again.",
    });
    expect(fixture.call).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty write result uncertain and never repeats the write", async () => {
    fixture.call.mockResolvedValue({ content: [] });
    const host = await connectHost();
    await expect(
      host.call("arco_comment", { requestId: "same-comment" }),
    ).rejects.toMatchObject({
      kind: "uncertain",
      message: expect.stringContaining(
        "Check the result in the source and refresh before submitting this change again.",
      ),
    });
    expect(fixture.call).toHaveBeenCalledExactlyOnceWith({
      name: "arco_comment",
      arguments: { requestId: "same-comment" },
    });
  });

  it.each([
    ["fullscreen", "inline", "Could not open issue details. Try again."],
    ["inline", "fullscreen", "Could not show the issue in chat. Try again."],
    ["pip", "fullscreen", "Could not open the compact view. Try again."],
  ] as const)(
    "explains a rejected %s display request without internal mode names",
    async (requested, kept, message) => {
      fixture.display.mockResolvedValue({ mode: kept });
      const host = await connectHost();
      await expect(host.display(requested)).rejects.toThrow(message);
      expect(host.mode()).toBe(kept);
      expect(fixture.display).toHaveBeenCalledExactlyOnceWith({
        mode: requested,
      });
    },
  );
});

function nativeAnnotations(
  annotations: SelectionAnnotationContext[],
  updateId = "native-annotations",
  snapshotId?: string,
) {
  return { ...annotationAttachment(annotations, snapshotId), updateId };
}

function legacyAnnotations(
  annotations: SelectionAnnotationContext[],
  snapshotId?: string,
) {
  const first = annotations[0]!;
  const context = {
    ...(annotations.length === 1
      ? { ...(first.issue ?? { source: "arco" }), selection: first.selection }
      : { source: "arco" }),
    annotations,
    ...(snapshotId ? { arcoAnnotationSnapshotId: snapshotId } : {}),
  };
  const title = `${annotations.length} annotation${annotations.length === 1 ? "" : "s"}`;
  const content = annotations.map((annotation) => {
    const identifier = annotation.issue
      ? annotation.issue.source === "github"
        ? `${annotation.issue.repo} #${annotation.issue.number}`
        : annotation.issue.identifier
      : "Arco";
    return {
      type: "text" as const,
      text: `${annotation.number}. ${identifier}\n${annotation.selection.text}${annotation.selection.comment ? `\n\nComment: ${annotation.selection.comment}` : ""}`,
      _meta: {
        "openai/title": `#${annotation.number} ${annotation.selection.text}`,
        "openai/group": { title },
      },
    };
  });
  return {
    updateId: "legacy-annotations",
    content: [
      ...content,
      {
        type: "text" as const,
        text: `Issue context (source data):\n${JSON.stringify(context)}`,
        annotations: { audience: ["assistant" as const] },
        _meta: { "openai/group": { title } },
      },
    ],
    structuredContent: {
      ...context,
      ...("source" in context && context.source !== "arco"
        ? { arcoSharedIssue: 1 }
        : {}),
    },
  };
}

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

  it("applies a complete native attachment snapshot and ignores unsupported selection-only context", async () => {
    const host = await connectHost();
    const observed: unknown[] = [];
    host.subscribe((event) => {
      if (event === "context")
        observed.push({
          issue: host.sharedIssue(),
          annotations: host.sharedAnnotations(),
          snapshotId: host.annotationSnapshotId(),
        });
    });
    const annotation = annotationFor(1);
    const id = "d849445f-dbf3-4988-847b-81d2966dc0a2";
    changed({
      "openai/modelContext": nativeAnnotations(
        [annotation],
        "native-current",
        id,
      ),
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
    expect(params.structuredContent).toEqual({
      source: "arco",
      arcoAnnotationFormat: 2,
      arcoAnnotationSnapshotId: id,
    });
    expect(host.annotationSnapshotId()).toBe(id);
    fixture.context = {
      "openai/modelContext": { ...params, updateId: "with-positions" },
    };
    const restored = await connectHost();
    expect(restored.annotationSnapshotId()).toBe(id);
    expect(restored.sharedAnnotations()).toEqual([annotationFor(1)]);
    changed({ "openai/modelContext": null });
    expect(restored.annotationSnapshotId()).toBeNull();
    expect(restored.sharedAnnotations()).toBeNull();
    await expect(
      restored.shareAnnotations([annotationFor(1)], "../settings"),
    ).rejects.toThrow();
    expect(fixture.update).toHaveBeenCalledTimes(1);
  });

  it("removes acknowledged context without an echo and ignores presentation changes", async () => {
    fixture.update.mockResolvedValue(acknowledged("own-update"));
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    await host.shareAnnotations([annotationFor(1)]);
    expect(host.sharedIssue()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 1,
    });
    expect(host.sharedAnnotations()).toEqual([annotationFor(1)]);
    changed({ theme: "dark", containerDimensions: { width: 390 } });
    expect(host.sharedIssue()?.source).toBe("github");
    expect(events).toEqual(["context"]);
    const params = fixture.update.mock.calls[0]![0];
    expect(params.structuredContent).toEqual({
      source: "arco",
      arcoAnnotationFormat: 2,
    });
    const content = params.content as {
      text: string;
      _meta: Record<string, unknown>;
      annotations?: unknown;
    }[];
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({
      type: "text",
      _meta: {
        "openai/title": "Selected words 1",
        "openai/group": { title: "Annotations" },
        "arco/annotation": annotationFor(1),
      },
    });
    expect(content[0]!.annotations).toBeUndefined();
    expect(content[0]!.text).toContain("Selected text:\nSelected words 1");
    changed({ "openai/modelContext": null });
    expect(host.sharedIssue()).toBeNull();
    expect(host.sharedAnnotations()).toBeNull();
    expect(events).toEqual(["context", "context"]);
  });

  it("groups self-contained GitHub and Linear items and edits one note without replacing the other annotation", async () => {
    fixture.update.mockResolvedValue(acknowledged("collection"));
    const host = await connectHost();
    const github = annotationFor(1, "GitHub note");
    const linear = linearAnnotation(2);
    await host.shareAnnotations([github, linear]);
    expect(host.sharedIssue()).toBeNull();
    expect(host.sharedAnnotations()).toEqual([github, linear]);
    const first = fixture.update.mock.calls[0]![0];
    expect(first.structuredContent).toEqual({
      source: "arco",
      arcoAnnotationFormat: 2,
    });
    const content = first.content as {
      text: string;
      _meta: Record<string, unknown>;
    }[];
    expect(content).toHaveLength(2);
    expect(content[0]!.text).toContain(
      "Selected text:\nSelected words 1\n\nUser comment:\nGitHub note",
    );
    expect(content[0]!.text).toContain("https://github.com/yu/Arco/issues/1");
    expect(content[0]!.text).not.toContain("Linear words 2");
    expect(content[1]!.text).toContain(
      "Selected text:\nLinear words 2\n\nUser comment:\nLinear note",
    );
    expect(content[1]!.text).not.toContain("Selected words 1");
    for (const block of content)
      expect(block._meta["openai/group"]).toEqual({ title: "Annotations" });
    const edited = annotationFor(1, "Edited GitHub note");
    await host.shareAnnotations([edited, linear]);
    expect(host.sharedAnnotations()).toEqual([edited, linear]);
    const saved = fixture.update.mock.calls[1]![0];
    expect((saved.content as unknown[])[1]).toEqual(content[1]);
    fixture.context = {
      "openai/modelContext": { ...saved, updateId: "restored-collection" },
    };
    const restored = await connectHost();
    expect(restored.sharedAnnotations()).toEqual([edited, linear]);
    expect(restored.sharedIssue()).toBeNull();
  });

  it("shortens only the annotation title while preserving the complete selected text", async () => {
    fixture.update.mockResolvedValue(acknowledged("long-selection"));
    const host = await connectHost();
    const annotation = annotationFor(1);
    annotation.selection.text = `  Preserve\n\t${"x".repeat(80)}  `;
    await host.shareAnnotations([annotation]);
    const params = fixture.update.mock.calls[0]![0];
    const content = params.content as {
      text: string;
      _meta: Record<string, unknown>;
    }[];
    expect(content).toHaveLength(1);
    expect(content[0]!._meta["openai/title"]).toBe(
      `Preserve ${"x".repeat(55)}…`,
    );
    expect(content[0]!.text).toContain(
      `Selected text:\n${annotation.selection.text}`,
    );
    expect(content[0]!._meta["arco/annotation"]).toEqual(annotation);
    expect(JSON.stringify(params.structuredContent)).not.toContain("Preserve");
  });

  it("clears the last annotation and rejects invalid or duplicate internal keys before sending", async () => {
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
      structuredContent: { source: "arco", arcoAnnotationFormat: 2 },
    });
    expect(host.sharedAnnotations()).toEqual([]);
    expect(host.sharedIssue()).toBeNull();
  });

  it("takes native individual content removal as authoritative without changing background metadata", async () => {
    const annotations = [
      annotationFor(1, "first note"),
      annotationFor(2, "remove this note"),
      linearAnnotation(3),
    ];
    const id = "d849445f-dbf3-4988-847b-81d2966dc0a2";
    const initial = nativeAnnotations(annotations, "three-annotations", id);
    fixture.context = { "openai/modelContext": initial };
    const host = await connectHost();
    const remaining = {
      ...initial,
      content: [initial.content[0]!, initial.content[2]!],
      updateId: "native-delete-middle",
    };
    changed({ "openai/modelContext": remaining });
    expect(host.sharedAnnotations()).toEqual([annotations[0], annotations[2]]);
    expect(host.annotationSnapshotId()).toBe(id);
    const modelInput = JSON.stringify({
      content: remaining.content,
      structuredContent: remaining.structuredContent,
    });
    expect(modelInput).not.toContain("Selected words 2");
    expect(modelInput).not.toContain("remove this note");
    expect(modelInput).toContain("Linear words 3");
    changed({
      "openai/modelContext": {
        ...remaining,
        content: [],
        updateId: "native-delete-last-items",
      },
    });
    expect(host.sharedAnnotations()).toEqual([]);
    expect(host.annotationSnapshotId()).toBeNull();
    expect(host.sharedIssue()).toBeNull();
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it("keeps host titles independent of display numbers when editing after a native deletion", async () => {
    fixture.update.mockResolvedValue(acknowledged("renumbered"));
    const second = annotationFor(2, "keep second");
    const third = linearAnnotation(3);
    fixture.context = {
      "openai/modelContext": nativeAnnotations([second, third]),
    };
    const host = await connectHost();
    await host.shareAnnotations([
      second,
      { ...third, selection: { ...third.selection, comment: "edited third" } },
    ]);
    const content = fixture.update.mock.calls[0]![0].content as {
      text: string;
      _meta: Record<string, unknown>;
    }[];
    expect(content[0]!._meta["openai/title"]).toBe("Selected words 2");
    expect(content[0]!.text.startsWith("yu/Arco #2\n")).toBe(true);
    expect(content[0]!._meta["arco/annotation"]).toEqual(second);
    expect(content[1]!._meta["openai/title"]).toBe("Linear words 3");
    expect(content[1]!.text.startsWith("YU-3\n")).toBe(true);
    expect(content[1]!.text).toContain("User comment:\nedited third");
  });

  it("normalizes only still-visible legacy blocks and drops deleted source copies", async () => {
    fixture.update.mockResolvedValue(acknowledged("normalized"));
    const removed = annotationFor(1, "deleted old note");
    const kept = linearAnnotation(2);
    const id = "d849445f-dbf3-4988-847b-81d2966dc0a2";
    const legacy = legacyAnnotations([removed, kept], id);
    legacy.content.splice(0, 1);
    fixture.context = { "openai/modelContext": legacy };
    const host = await connectHost();
    await vi.waitFor(() => expect(fixture.update).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(host.sharedAnnotations()).toEqual([kept]));
    expect(host.annotationSnapshotId()).toBe(id);
    const normalized = fixture.update.mock.calls[0]![0];
    const content = normalized.content as {
      text: string;
      _meta: Record<string, unknown>;
    }[];
    expect(content).toHaveLength(1);
    expect(content[0]!._meta["arco/annotation"]).toEqual(kept);
    expect(content[0]!._meta["openai/title"]).toBe("Linear words 2");
    expect(normalized.structuredContent).toEqual({
      source: "arco",
      arcoAnnotationFormat: 2,
      arcoAnnotationSnapshotId: id,
    });
    expect(JSON.stringify(normalized)).not.toContain("Selected words 1");
    expect(JSON.stringify(normalized)).not.toContain("deleted old note");
    expect(JSON.stringify(normalized)).not.toContain(
      "Issue context (source data)",
    );
  });

  it("clears a legacy attachment with only hidden duplicates and does not restore it from positions", async () => {
    fixture.update.mockResolvedValue(acknowledged("cleared-legacy"));
    const legacy = legacyAnnotations(
      [annotationFor(1)],
      "d849445f-dbf3-4988-847b-81d2966dc0a2",
    );
    legacy.content.splice(0, 1);
    fixture.context = { "openai/modelContext": legacy };
    const host = await connectHost();
    await vi.waitFor(() => expect(fixture.update).toHaveBeenCalledTimes(1));
    expect(fixture.update.mock.calls[0]![0]).toEqual({
      content: [],
      structuredContent: { source: "arco", arcoAnnotationFormat: 2 },
    });
    expect(host.sharedAnnotations()).toEqual([]);
    expect(host.annotationSnapshotId()).toBeNull();
  });

  it("does not expose a connected host when legacy normalization is unconfirmed", async () => {
    fixture.update.mockResolvedValue({});
    fixture.context = {
      "openai/modelContext": legacyAnnotations([annotationFor(1)]),
    };
    await expect(connectHost()).rejects.toThrow(
      "did not confirm the context attachment",
    );
    expect(fixture.update).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {
      updateId: "replacement",
      structuredContent: {
        source: "github",
        repo: "yu/Arco",
        number: 42,
        arcoSharedIssue: 1,
      },
    },
  ])(
    "keeps native removal or replacement over a delayed legacy normalization ACK: %j",
    async (native) => {
      const pending = deferred();
      fixture.update.mockReturnValue(pending.promise);
      fixture.context = {
        "openai/modelContext": legacyAnnotations([annotationFor(1)]),
      };
      const connecting = connectHost();
      await vi.waitFor(() => expect(fixture.update).toHaveBeenCalledTimes(1));
      changed({ "openai/modelContext": native });
      pending.resolve(acknowledged("normalized-legacy"));
      const host = await connecting;
      expect(host.sharedAnnotations()).toBeNull();
      expect(host.sharedIssue()).toEqual(
        native ? { source: "github", repo: "yu/Arco", number: 42 } : null,
      );
      await Promise.resolve();
      expect(fixture.update).toHaveBeenCalledTimes(1);
    },
  );

  it("does not restore a pending collection after a native removal", async () => {
    const saved = [annotationFor(1), linearAnnotation(2)];
    fixture.context = {
      "openai/modelContext": nativeAnnotations(saved, "existing-collection"),
    };
    const pending = deferred();
    fixture.update.mockReturnValue(pending.promise);
    const host = await connectHost();
    expect(host.sharedAnnotations()).toEqual(saved);
    const editing = host.shareAnnotations([
      annotationFor(1, "Pending edit"),
      saved[1]!,
    ]);
    changed({ "openai/modelContext": null });
    pending.resolve(acknowledged("pending-edit"));
    await editing;
    expect(host.sharedAnnotations()).toBeNull();
    expect(host.sharedIssue()).toBeNull();
  });

  it("keeps optional comments separate from source selection text in one removable block", async () => {
    fixture.update.mockResolvedValue(acknowledged("commented-selection"));
    const host = await connectHost();
    const context = annotationFor(
      1,
      "Explain this paragraph.\nKeep the native ID.",
    );
    await host.shareAnnotations([context]);
    expect(host.sharedAnnotations()).toEqual([context]);
    const params = fixture.update.mock.calls[0]![0];
    const content = params.content as {
      text: string;
      _meta: Record<string, unknown>;
    }[];
    expect(content).toHaveLength(1);
    expect(content[0]!.text).toContain(
      "Selected text:\nSelected words 1\n\nUser comment:\nExplain this paragraph.\nKeep the native ID.",
    );
    expect(content[0]!._meta["arco/annotation"]).toEqual(context);
    expect(JSON.stringify(params.structuredContent)).not.toContain(
      context.selection.text,
    );
    expect(JSON.stringify(params.structuredContent)).not.toContain(
      context.selection.comment,
    );
    changed({ "openai/modelContext": null });
    expect(host.sharedAnnotations()).toBeNull();
  });

  it("restores a native selected comment and clears it when replaced by whole-Issue context", async () => {
    const annotation = linearAnnotation(1);
    annotation.selection = {
      text: "Original comment fragment",
      origin: "comment",
      commentId: "native-comment",
      comment: "My separate question",
    };
    fixture.context = {
      "openai/modelContext": nativeAnnotations(
        [annotation],
        "restored-selection",
      ),
    };
    const host = await connectHost();
    expect(host.sharedAnnotations()).toEqual([annotation]);
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
    expect(host.sharedAnnotations()).toBeNull();
    expect(host.sharedIssue()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 2,
    });
  });

  it("ignores unchanged model context in presentation snapshots, including while awaiting an ACK", async () => {
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
      ...fixture.update.mock.calls[0]![0],
      updateId: "own-update",
    };
    changed({ "openai/modelContext": echoed });
    changed({
      theme: "dark",
      containerDimensions: { width: 1200 },
      "openai/modelContext": echoed,
    });
    changed({ "openai/modelContext": echoed });
    expect(events).toEqual(["context"]);
    expect(host.sharedIssue()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 1,
    });
  });

  it("reports an unconfirmed attachment instead of applying local success without ACK metadata", async () => {
    fixture.update.mockResolvedValue({});
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    await expect(
      host.shareAnnotations([
        { number: 1, selection: { text: "Arco", origin: "ui" } },
      ]),
    ).rejects.toThrow("did not confirm the context attachment");
    expect(host.sharedIssue()).toBeNull();
    expect(host.sharedAnnotations()).toBeNull();
    changed({ "openai/modelContext": null });
    expect(host.sharedAnnotations()).toBeNull();
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
    nativeAnnotations(
      [{ ...annotationFor(1), issue: annotationFor(2).issue }],
      "native-selection-replacement",
    ),
  ])(
    "keeps native removal or replacement received before the ACK: %j",
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
      expect(host.sharedIssue()).toEqual(
        native ? { source: "github", repo: "yu/Arco", number: 2 } : null,
      );
      expect(host.sharedAnnotations()).toEqual(
        native && "content" in native
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

  it("accepts its own echo before the ACK and refuses concurrent writes until explicit retry", async () => {
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
        ...fixture.update.mock.calls[0]![0],
        updateId: "own-update",
      },
    });
    pending.resolve(acknowledged("own-update"));
    await first;
    expect(host.sharedIssue()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 1,
    });
    expect(host.sharedAnnotations()).toEqual([original]);
    const revised = annotationFor(1, "A different note on the same words");
    changed({
      "openai/modelContext": nativeAnnotations([revised], "native-edited-note"),
    });
    expect(host.sharedAnnotations()).toEqual([revised]);
    fixture.update.mockResolvedValueOnce(acknowledged("explicit-retry"));
    await host.shareAnnotations([annotationFor(2)]);
    expect(fixture.update).toHaveBeenCalledTimes(2);
    expect(host.sharedIssue()).toEqual({
      source: "github",
      repo: "yu/Arco",
      number: 2,
    });
    expect(host.sharedAnnotations()).toEqual([annotationFor(2)]);
  });

  it("releases a rejected attachment without replacing context or retrying automatically", async () => {
    fixture.update.mockRejectedValueOnce(new Error("Host rejected attachment"));
    const host = await connectHost();
    const events: string[] = [];
    host.subscribe((event) => events.push(event));
    await expect(host.shareAnnotations([annotationFor(1)])).rejects.toThrow(
      "Host rejected attachment",
    );
    expect(host.sharedIssue()).toBeNull();
    expect(host.sharedAnnotations()).toBeNull();
    expect(events).toEqual([]);
    expect(fixture.update).toHaveBeenCalledTimes(1);
    fixture.update.mockResolvedValueOnce(acknowledged("explicit-retry"));
    await host.shareAnnotations([annotationFor(1)]);
    expect(fixture.update).toHaveBeenCalledTimes(2);
    expect(events).toEqual(["context"]);
  });
});
