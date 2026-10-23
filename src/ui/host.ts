import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import {
  OPENAI_MODEL_CONTEXT_KEY,
  OpenAIExtensions,
  type OpenAIModelContextUpdateResult,
} from "@openai/mcp-extensions/app";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { imageDataSchema } from "../shared/images";
import {
  sharedRefFromContext,
  sharedAnnotationsFromContext,
} from "./shared-context";
import { createToolQueue } from "./tool-queue";
import { annotationAttachment, contextAttachment } from "./context-attachment";
import type {
  ArcoHost,
  ConversationIssue,
  SelectionAnnotationContext,
  SharedIssueRef,
} from "../shared/contracts";

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
  const listeners = new Set<(event: "data" | "display" | "context") => void>();
  const notify = (event: "data" | "display" | "context") =>
    listeners.forEach((listener) => listener(event));
  let contextVersion: string | null | undefined;
  let contextPresent = false;
  let contextRevision = 0;
  let sharedOverride: SharedIssueRef | null | undefined;
  let annotationsOverride: SelectionAnnotationContext[] | null | undefined;
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
        nextVersion !== contextVersion ||
        present !== contextPresent ||
        pendingRemoval
      ) {
        contextRevision += 1;
        contextVersion = nextVersion;
        contextPresent = present;
        sharedOverride = sharedRefFromContext(modelContext?.structuredContent);
        annotationsOverride = sharedAnnotationsFromContext(
          modelContext?.structuredContent,
        );
        notify("context");
      }
    }
  };
  app.ontoolresult = dataChanged;
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
    if (attachmentBusy)
      throw new Error(
        "Wait for the current attachment to finish, then try again.",
      );
    attachmentBusy = true;
    const revision = contextRevision;
    try {
      let receipt: OpenAIModelContextUpdateResult | undefined;
      if (openai.modelContext)
        receipt = await openai.modelContext.update(params);
      else await app.updateModelContext(params);
      // A native replacement or removal received while awaiting the ACK wins.
      // An echo of this exact update may arrive before its acknowledgement.
      if (
        contextRevision !== revision &&
        (!receipt || contextVersion !== receipt.updateId)
      )
        return;
      contextVersion = receipt?.updateId ?? contextVersion;
      contextPresent = true;
      sharedOverride = sharedRefFromContext(params.structuredContent);
      annotationsOverride = sharedAnnotationsFromContext(
        params.structuredContent,
      );
      notify("context");
    } finally {
      attachmentBusy = false;
    }
  }
  return {
    sharedIssue() {
      if (sharedOverride !== undefined) return sharedOverride;
      return sharedRefFromContext(
        openai.modelContext?.getCurrent()?.structuredContent,
      );
    },
    sharedAnnotations() {
      if (annotationsOverride !== undefined) return annotationsOverride;
      return sharedAnnotationsFromContext(
        openai.modelContext?.getCurrent()?.structuredContent,
      );
    },
    async readImage(issue, url, commentId) {
      const result = await tools.run(() =>
        app.callServerTool({
          name:
            issue.source === "github" ? "arco_read_image" : "linear_read_image",
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
      );
      if (result.isError)
        throw new Error("The source image preview could not be loaded.");
      return imageDataSchema.parse(result._meta?.image);
    },
    async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const result = await tools.run(() =>
        app.callServerTool({ name, arguments: args }),
      );
      if (result.isError) {
        const message = result.content?.find((item) => item.type === "text");
        throw new Error(
          message?.type === "text" ? message.text : "The operation failed.",
        );
      }
      if (result.structuredContent == null)
        throw new Error("The server response contains no data.");
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
    async shareAnnotations(annotations) {
      const parsed = sharedAnnotationsFromContext({
        source: "arco",
        annotations,
      });
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
      await attach(annotationAttachment(context, items));
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
