import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  CallToolResultSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  OPENAI_MESSAGE_KEY,
  OPENAI_MODEL_CONTEXT_KEY,
  OpenAIMessageParamsSchema,
  type OpenAIModelContextHostState,
} from "@openai/mcp-extensions/app";
import { z } from "zod";
import type { DisplayMode } from "../src/shared/contracts";

const frame = document.querySelector<HTMLIFrameElement>("#arco")!;
const eventsElement = document.querySelector<HTMLElement>("#events")!;
const statusElement = document.querySelector<HTMLElement>("#bridge-status")!;
const errorElement = document.querySelector<HTMLElement>("#harness-error")!;
const events: { type: string; value: unknown }[] = [];
let session: string;
function record(type: string, value: unknown) {
  events.push({ type, value });
  eventsElement.textContent = JSON.stringify(events, null, 2);
}
function report(error: unknown) {
  errorElement.textContent =
    error instanceof Error ? error.message : String(error);
}
async function tool(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const response = await fetch("/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, name, arguments: args }),
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error(`Fixture tool request failed: ${JSON.stringify(data)}`);
  return CallToolResultSchema.parse(data);
}

const bridge = new AppBridge(
  null,
  { name: "Arco mock browser host — not Codex", version: "0.1.0" },
  {
    serverTools: {},
    openLinks: {},
    updateModelContext: {},
    message: {},
    experimental: { [OPENAI_MESSAGE_KEY]: {}, [OPENAI_MODEL_CONTEXT_KEY]: {} },
  },
);
let displayMode: DisplayMode = "fullscreen";
let sharedContext: OpenAIModelContextHostState = null;
const displayFallback = document.createElement("input");
displayFallback.type = "checkbox";
const displayFallbackLabel = document.createElement("label");
displayFallbackLabel.append(displayFallback, " Mock keep current display mode");
document.querySelector("header")!.append(displayFallbackLabel);
function display(mode: DisplayMode) {
  displayMode = mode;
  bridge.setHostContext({
    theme: "dark",
    [OPENAI_MODEL_CONTEXT_KEY]: sharedContext,
    displayMode,
    availableDisplayModes: ["inline", "fullscreen"],
    containerDimensions: {
      width: frame.clientWidth,
      maxHeight: frame.clientHeight,
    },
  });
  record("display", mode);
}
const toolLimit =
  new URL(location.href).searchParams.get("toolLimit") === "2" ? 2 : Infinity;
let activeTools = 0;
bridge.oncalltool = async (params) => {
  record("tool", { name: params.name, arguments: params.arguments });
  if (activeTools >= toolLimit) {
    record("tool-rejected", { name: params.name });
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "MCP error -32001: App server request queue is full",
        },
      ],
    };
  }
  activeTools++;
  record("tool-pressure", { active: activeTools });
  try {
    return await tool(params.name, params.arguments ?? {});
  } finally {
    activeTools--;
    record("tool-pressure", { active: activeTools });
  }
};

document.querySelector<HTMLButtonElement>("#host-context-burst")!.onclick =
  () => {
    for (let index = 0; index < 25; index++)
      bridge.setHostContext({
        theme: index % 2 ? "light" : "dark",
        containerDimensions: {
          width: frame.clientWidth + index,
          maxHeight: frame.clientHeight,
        },
      });
    bridge.setHostContext({ theme: "dark" });
    record("presentation-updates", 26);
  };
// The v1 standard handler strips extension metadata. Validate the extended
// request using the public OpenAI schema so send:false/target remain inspectable.
bridge.setRequestHandler(
  z.object({
    method: z.literal("ui/message"),
    params: OpenAIMessageParamsSchema,
  }),
  async (request) => {
    record("message", request.params);
    return {};
  },
);
bridge.onupdatemodelcontext = async (params) => {
  sharedContext = { ...params, updateId: crypto.randomUUID() };
  bridge.setHostContext({ [OPENAI_MODEL_CONTEXT_KEY]: sharedContext });
  record("context", params);
  return {
    _meta: { [OPENAI_MODEL_CONTEXT_KEY]: { updateId: sharedContext.updateId } },
  };
};
bridge.onopenlink = async (params) => {
  record("link", params);
  return {};
};
bridge.onrequestdisplaymode = async ({ mode }) => {
  const actual = displayFallback.checked ? displayMode : mode;
  record("display-request", { requested: mode, actual });
  display(actual);
  return { mode: actual };
};
bridge.oninitialized = async () => {
  statusElement.textContent = "ready";
  await bridge.sendToolInput({ arguments: {} });
  await bridge.sendToolResult(await tool("arco_open", {}));
};

for (const mode of ["inline", "fullscreen"] as const) {
  document.querySelector<HTMLButtonElement>(`#mode-${mode}`)!.onclick = () =>
    display(mode);
}
document.querySelector<HTMLButtonElement>("#external-update")!.onclick = () => {
  void (async () => {
    const current = await tool("arco_get_issue", {
      repo: "yu/Arco",
      number: 42,
    });
    const updated = await tool("arco_update_issue", {
      repo: "yu/Arco",
      number: 42,
      requestId: crypto.randomUUID(),
      expectedUpdatedAt: current.structuredContent?.updatedAt,
      patch: {
        title: "Issue updated by a Codex tool",
        body: "The source update was fetched into the same UI.",
      },
    });
    if (updated.isError) throw new Error(JSON.stringify(updated.content));
    record("external-update", updated.structuredContent);
    await bridge.sendToolResult(updated);
  })().catch(report);
};
let linearUpdateSequence = 0;
document.querySelector<HTMLButtonElement>("#linear-external-update")!.onclick =
  () => {
    void (async () => {
      const ref = {
        connectionId: "default",
        workspaceId: "fixture-linear-workspace",
        teamId: "fixture-linear-team",
        issueId: "fixture-linear-42",
      };
      const current = await tool("linear_get_issue", ref);
      const sequence = ++linearUpdateSequence;
      const updated = await tool("linear_update_issue", {
        ...ref,
        requestId: crypto.randomUUID(),
        expectedUpdatedAt: current.structuredContent?.updatedAt,
        patch: {
          title: `Linear issue updated by a Codex tool ${sequence}`,
          body: `External Linear update ${sequence} was fetched into this UI.`,
        },
      });
      if (updated.isError) throw new Error(JSON.stringify(updated.content));
      record("linear-external-update", updated.structuredContent);
      await bridge.sendToolResult(updated);
    })().catch(report);
  };

document.querySelector<HTMLFormElement>("#mention-form")!.onsubmit = (
  event,
) => {
  event.preventDefault();
  const query =
    document.querySelector<HTMLInputElement>("#mention-query")!.value;
  void tool("search_mentions", { query })
    .then((result) => record("mentions", result.structuredContent))
    .catch(report);
};

async function start() {
  const response = await fetch("/session", { method: "POST" });
  const result = (await response.json()) as { session?: string };
  if (!response.ok || !result.session)
    throw new Error("Fixture MCP session could not start");
  session = result.session;
  await bridge.connect(
    new PostMessageTransport(frame.contentWindow!, frame.contentWindow!),
  );
  display(displayMode);
  frame.src = "/arco.html";
}
void start().catch(report);
