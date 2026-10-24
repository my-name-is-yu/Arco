import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import {
  OPENAI_MODEL_CONTEXT_KEY,
  OpenAIExtensions,
} from "@openai/mcp-extensions/app";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readToolFailure, ToolCallError } from "../shared/errors";
import { imageDataSchema } from "../shared/images";
import { annotationSnapshotIdSchema } from "../shared/annotation-state";
import {
  issuePresentationSummarySchema,
  launchContextSchema,
  nativeIssueTargetSchema,
  type LaunchContext,
  type NativeIssueTarget,
} from "../shared/launch";
import {
  readSharedContext,
  type SharedContextSnapshot,
} from "./shared-context";
import { createToolQueue } from "./tool-queue";
import { annotationAttachment, contextAttachment } from "./context-attachment";
import type {
  ArcoHost,
  ConversationIssue,
  PresentationIssues,
} from "../shared/contracts";

function presentationKey(target: NativeIssueTarget) {
  return JSON.stringify(
    target.source === "github"
      ? [target.source, target.repo.toLowerCase(), target.number]
      : [
          target.source,
          target.connectionId,
          target.workspaceId,
          target.teamId,
          target.issueId,
        ],
  );
}

function presentationIssues(
  metadata: Record<string, unknown> | undefined,
  launch: LaunchContext,
): PresentationIssues | null {
  if (metadata?.issueDetails === undefined || !launch.issues) return null;
  const details = metadata.issueDetails;
  if (
    !Array.isArray(details) ||
    details.length !== launch.issues.length ||
    details.some((detail, index) => {
      const summary = issuePresentationSummarySchema.options[
        detail?.source === "github" ? 0 : 1
      ]
        .strip()
        .safeParse(detail);
      return (
        !summary.success ||
        JSON.stringify(summary.data) !==
          JSON.stringify(launch.issues![index]) ||
        typeof detail.body !== "string" ||
        typeof detail.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(detail.updatedAt)) ||
        !Array.isArray(detail.labels) ||
        !Array.isArray(detail.comments) ||
        (detail.source === "github" &&
          (!Array.isArray(detail.assignees) || !Array.isArray(detail.projects)))
      );
    })
  )
    throw new ToolCallError(
      "invalid-response",
      "The server returned different or invalid issue details. Refresh to try again.",
    );
  return { issues: details as ConversationIssue[], receivedAt: Date.now() };
}

function issueContext(issue: ConversationIssue) {
  if (issue.source === "linear")
    return {
      source: "linear",
      connectionId: issue.connectionId,
      workspaceId: issue.workspaceId,
      teamId: issue.teamId,
      id: issue.issueId,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      state: issue.state,
      body: issue.body,
      labels: issue.labels.map((label) => ({
        id: label.id,
        name: label.name,
      })),
      assignee: issue.assignee,
      project: issue.project,
      cycle: issue.cycle,
      priority: issue.priority,
      estimate: issue.estimate,
      dueDate: issue.dueDate,
    };
  return {
    source: issue.source,
    repo: issue.repo,
    number: issue.number,
    id: issue.id,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    body: issue.body,
    labels: issue.labels.map((label) => label.name),
    assignees: issue.assignees,
    projects: issue.projects,
  };
}

export async function connectHost(): Promise<ArcoHost> {
  z.config({ jitless: true });
  const app = new App(
    { name: "Arco", version: "0.1.0" },
    {},
    { autoResize: true },
  );
  const openai = new OpenAIExtensions(app);
  const tools = createToolQueue();
  let displayMode = app.getHostContext()?.displayMode ?? "inline";
  let launchContext: LaunchContext | null = null;
  let launchError: string | null = null;
  let presentedIssues: PresentationIssues | null = null;
  const listeners = new Set<
    (event: "data" | "display" | "context" | "launch") => void
  >();
  const notify = (event: "data" | "display" | "context" | "launch") =>
    listeners.forEach((listener) => listener(event));
  let contextRevision = 0;
  let attachment: SharedContextSnapshot & {
    updateId?: string | null;
    present: boolean;
  } = { ...readSharedContext(undefined), present: false };
  const applyAttachment = (
    value: unknown,
    updateId: string | null | undefined,
    present: boolean,
  ) => {
    attachment = { ...readSharedContext(value), updateId, present };
    notify("context");
  };
  let attachmentBusy = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const dataChanged = () => {
    if (refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      notify("data");
    }, 100);
  };
  const applyContext = (change?: Record<string, unknown>) => {
    const context = app.getHostContext();
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables)
      applyHostStyleVariables(context.styles.variables);
    if (context?.displayMode && context.displayMode !== displayMode) {
      displayMode = context.displayMode;
      notify("display");
    }
    const modelContext =
      change === undefined || Object.hasOwn(change, OPENAI_MODEL_CONTEXT_KEY)
        ? openai.modelContext?.getCurrent()
        : undefined;
    if (modelContext !== undefined) {
      const nextVersion = modelContext?.updateId ?? null;
      const present = modelContext !== null;
      const pendingRemoval =
        attachmentBusy &&
        !present &&
        change !== undefined &&
        Object.keys(change).length === 1;
      if (
        nextVersion !== attachment.updateId ||
        present !== attachment.present ||
        pendingRemoval
      ) {
        contextRevision += 1;
        applyAttachment(modelContext?.structuredContent, nextVersion, present);
      }
    }
  };
  app.ontoolresult = (result) => {
    if (!launchContext) {
      if (result.isError) {
        launchError = readToolFailure(result.structuredContent).message;
        notify("launch");
      } else {
        const parsed = launchContextSchema.safeParse(
          result.structuredContent?.launch,
        );
        if (parsed.success) {
          try {
            presentedIssues = presentationIssues(result._meta, parsed.data);
          } catch (error) {
            launchError = (error as Error).message;
            notify("launch");
            return;
          }
          launchContext = parsed.data;
          launchError = null;
          if (refreshTimer !== undefined) {
            clearTimeout(refreshTimer);
            refreshTimer = undefined;
          }
          notify("launch");
          return;
        }
      }
    }
    dataChanged();
  };
  app.onhostcontextchanged = applyContext;
  app.setNotificationHandler(ResourceUpdatedNotificationSchema, dataChanged);
  app.onteardown = async () => {
    tools.close();
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    listeners.clear();
    return {};
  };
  await app.connect();
  applyContext();
  async function attach(params: Parameters<App["updateModelContext"]>[0]) {
    if (!openai.modelContext)
      throw new Error(
        "This Codex host does not support synchronized context attachments. Update Codex before sharing.",
      );
    if (attachmentBusy)
      throw new Error(
        "Wait for the current attachment to finish, then try again.",
      );
    attachmentBusy = true;
    const revision = contextRevision;
    try {
      const receipt = await openai.modelContext.update(params);
      if (!receipt)
        throw new Error(
          "Codex did not confirm the context attachment. Check the conversation before sharing again.",
        );
      // A native replacement or removal received while awaiting the ACK wins.
      // An echo of this exact update may arrive before its acknowledgement.
      if (
        contextRevision !== revision &&
        attachment.updateId !== receipt.updateId
      )
        return;
      applyAttachment(params.structuredContent, receipt.updateId, true);
    } finally {
      attachmentBusy = false;
    }
  }
  async function callServerTool(params: Parameters<App["callServerTool"]>[0]) {
    try {
      return await app.callServerTool(params);
    } catch {
      throw new ToolCallError(
        typeof params.arguments?.requestId === "string"
          ? "uncertain"
          : "unavailable",
        "Codex did not return an operation result.",
      );
    }
  }
  return {
    launch() {
      return launchContext;
    },
    launchError() {
      return launchError;
    },
    presentationIssues() {
      return presentedIssues;
    },
    annotationSnapshotId() {
      return attachment.snapshotId;
    },
    sharedIssue() {
      return attachment.issue;
    },
    sharedAnnotations() {
      return attachment.annotations;
    },
    async readImage(issue, url, commentId, options) {
      const result = await tools.run(
        () =>
          callServerTool({
            name:
              issue.source === "github"
                ? "arco_read_image"
                : "linear_read_image",
            arguments: {
              ...(issue.source === "github"
                ? { repo: issue.repo, number: issue.number }
                : {
                    connectionId: issue.connectionId,
                    workspaceId: issue.workspaceId,
                    teamId: issue.teamId,
                    issueId: issue.issueId,
                  }),
              url,
              ...(commentId === undefined ? {} : { commentId }),
            },
          }),
        options,
      );
      if (result.isError) throw readToolFailure(result.structuredContent);
      const parsed = imageDataSchema.safeParse(result._meta?.image);
      if (!parsed.success)
        throw new ToolCallError(
          "invalid-response",
          "The server returned invalid image data.",
        );
      return parsed.data;
    },
    async call<T>(
      name: string,
      args: Record<string, unknown>,
      options?: Parameters<ArcoHost["call"]>[2],
    ): Promise<T> {
      const result = await tools.run(
        () => callServerTool({ name, arguments: args }),
        options,
      );
      if (result.isError) {
        throw readToolFailure(result.structuredContent);
      }
      if (result.structuredContent == null)
        throw new ToolCallError(
          "invalid-response",
          "The server response contains no data.",
        );
      if (name === "arco_show_issues") {
        const launch = launchContextSchema.parse(
          result.structuredContent.launch,
        );
        const requested = z
          .array(nativeIssueTargetSchema)
          .safeParse(args.targets);
        const keys = requested.success
          ? [...new Set(requested.data.map(presentationKey))]
          : [];
        if (
          !launch.issues ||
          keys.length !== launch.issues.length ||
          launch.issues.some(
            (issue, index) => presentationKey(issue) !== keys[index],
          )
        )
          throw new ToolCallError(
            "invalid-response",
            "The server returned different issue targets. Refresh to try again.",
          );
        const details = presentationIssues(result._meta, launch);
        if (details) presentedIssues = details;
      }
      return result.structuredContent as T;
    },
    async share(issue) {
      const identifier =
        issue.source === "github"
          ? `${issue.repo} #${issue.number}`
          : issue.identifier;
      const context = issueContext(issue);
      await attach(
        contextAttachment(
          context,
          `${identifier} ${issue.title}\n${issue.url}`,
          `${identifier} ${issue.title}`,
        ),
      );
    },
    async shareAnnotations(annotations, snapshotId) {
      if (snapshotId !== undefined)
        snapshotId = annotationSnapshotIdSchema.parse(snapshotId);
      const parsed = readSharedContext({
        source: "arco",
        annotations,
      }).annotations;
      if (!parsed)
        throw new Error(
          "Annotations must have valid, unique positive numbers.",
        );
      if (!parsed.length) {
        await attach({
          content: [],
          structuredContent: { source: "arco", annotations: [] },
        });
        return;
      }
      const first = parsed[0]!;
      const context =
        parsed.length === 1
          ? {
              ...(first.issue ?? { source: "arco" }),
              selection: first.selection,
              annotations: parsed,
            }
          : { source: "arco", annotations: parsed };
      const items = parsed.map(({ number, issue, selection }) => {
        const identifier = issue
          ? issue.source === "github"
            ? `${issue.repo} #${issue.number}`
            : issue.identifier
          : "Arco";
        const preview = selection.text.replace(/\s+/g, " ").trim();
        return {
          text: `${number}. ${identifier}\n${selection.text}${selection.comment ? `\n\nComment: ${selection.comment}` : ""}`,
          title: `#${number} ${preview.length > 64 ? `${preview.slice(0, 64)}…` : preview}`,
        };
      });
      await attach(
        annotationAttachment(
          {
            ...context,
            ...(snapshotId ? { arcoAnnotationSnapshotId: snapshotId } : {}),
          },
          items,
        ),
      );
    },
    async openLink(url) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:")
        throw new Error("Only HTTPS links can be opened.");
      const result = await app.openLink({ url });
      if (result.isError) throw new Error("The host could not open the link.");
    },
    async display(mode) {
      const result = await app.requestDisplayMode({ mode });
      displayMode = result.mode;
      notify("display");
      if (result.mode !== mode)
        throw new Error(
          `The host could not switch to ${mode} mode. It kept ${result.mode} mode.`,
        );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mode() {
      return displayMode;
    },
  };
}
