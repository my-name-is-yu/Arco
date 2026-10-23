import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createStateStore } from "./state";
import {
  draftDeleteSchema,
  draftReadSchema,
  draftWriteSchema,
  settingsUpdateSchema,
} from "../shared/state";

export const stateToolSchemas = {
  arco_get_settings: z.object({}),
  arco_update_settings: settingsUpdateSchema,
  arco_read_draft: draftReadSchema,
  arco_write_draft: draftWriteSchema,
  arco_delete_draft: draftDeleteSchema,
};
export function registerStateTools(
  server: McpServer,
  store: ReturnType<typeof createStateStore>,
) {
  for (const name of Object.keys(
    stateToolSchemas,
  ) as (keyof typeof stateToolSchemas)[]) {
    server.registerTool(
      name,
      {
        title: name,
        description:
          "Read or explicitly save Arco settings / unsent drafts on this device. Contains no source credentials.",
        inputSchema: stateToolSchemas[name].shape,
        annotations: {
          readOnlyHint: ["arco_get_settings", "arco_read_draft"].includes(name),
          openWorldHint: false,
          destructiveHint: name === "arco_delete_draft",
        },
        _meta: { ui: { visibility: ["app"] } },
      },
      async (input: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          let value;
          switch (name) {
            case "arco_get_settings":
              value = await store.readSettings();
              break;
            case "arco_update_settings":
              value = await store.updateSettings(
                settingsUpdateSchema.parse(input),
              );
              break;
            case "arco_read_draft":
              value = await store.readDraft(draftReadSchema.parse(input).key);
              break;
            case "arco_write_draft":
              value = await store.writeDraft(draftWriteSchema.parse(input));
              break;
            case "arco_delete_draft":
              value = await store.deleteDraft(draftDeleteSchema.parse(input));
              break;
          }
          return { content: [], structuredContent: { ...value } };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Unable to save locally. Keep your current input.",
              },
            ],
          };
        }
      },
    );
  }
}
