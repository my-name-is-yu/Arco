import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { imageDataSchema } from "../shared/images";
import { sharedRefFromContext } from "./shared-context";
import { createToolQueue } from "./tool-queue";
import type {
  ArcoHost,
  ContextSelection,
  ConversationIssue,
} from "../shared/contracts";

export function issueContext(
  issue: ConversationIssue,
  selection?: ContextSelection,
) {
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
      ...(selection
        ? { selection }
        : {
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
          }),
    };
  return {
    source: issue.source,
    repo: issue.repo,
    number: issue.number,
    id: issue.id,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    ...(selection
      ? { selection }
      : {
          body: issue.body,
          labels: issue.labels.map((label) => label.name),
          assignees: issue.assignees,
          projects: issue.projects,
        }),
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
  const listeners = new Set<(event: "data" | "display") => void>();
  const notify = (event: "data" | "display") =>
    listeners.forEach((listener) => listener(event));
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const dataChanged = () => {
    if (refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      notify("data");
    }, 100);
  };
  const applyContext = () => {
    const context = app.getHostContext();
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables)
      applyHostStyleVariables(context.styles.variables);
    if (context?.displayMode && context.displayMode !== displayMode) {
      displayMode = context.displayMode;
      notify("display");
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
  return {
    sharedIssue() {
      return sharedRefFromContext(
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
    async share(issue, selection) {
      const identifier =
        issue.source === "github"
          ? `${issue.repo} #${issue.number}`
          : issue.identifier;
      const context = issueContext(issue, selection);
      const params = {
        content: [
          {
            type: "text" as const,
            text: `${identifier} ${issue.title}\n${issue.url}\n\nIssue context (source data):\n${JSON.stringify(context)}`,
          },
        ],
        structuredContent: {
          ...context,
          arcoSharedIssue: 1,
        },
      };
      if (openai.modelContext) await openai.modelContext.update(params);
      else await app.updateModelContext(params);
    },
    async prompt(issue, text, target, send) {
      if (!openai.message)
        throw new Error(
          "This host does not support preparing or sending requests to current or new chats.",
        );
      const result = await openai.message.send({
        role: "user",
        content: [
          {
            type: "text",
            text: `${text}\n\nIssue context (source data):\n${JSON.stringify(issueContext(issue))}`,
          },
        ],
        _meta: {
          "openai/message": {
            target: target === "self" ? "active" : "new",
            send,
          },
        },
      });
      if (result.isError)
        throw new Error("The host did not accept the chat request.");
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
