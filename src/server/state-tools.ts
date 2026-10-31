import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  annotationSnapshotKeySchema,
  annotationSnapshotSchema,
} from "../shared/annotation-state";
import {
  draftDeleteSchema,
  draftReadSchema,
  draftWriteSchema,
  settingsUpdateSchema,
} from "../shared/state";
import { createStateStore } from "./state";
import { dataResult, failureResult } from "./tool-results";

export const stateToolSchemas = {
  arco_get_settings: z.object({}),
  arco_update_settings: settingsUpdateSchema,
  arco_read_draft: draftReadSchema,
  arco_write_draft: draftWriteSchema,
  arco_delete_draft: draftDeleteSchema,
  arco_read_annotation_snapshot: annotationSnapshotKeySchema,
  arco_write_annotation_snapshot: annotationSnapshotSchema,
  arco_delete_annotation_snapshot: annotationSnapshotKeySchema,
};
export function registerStateTools(
  server: McpServer,
  store: ReturnType<typeof createStateStore>,
) {
  (Object.keys(stateToolSchemas) as (keyof typeof stateToolSchemas)[]).forEach(
    (name) => {
      server.registerTool(
        name,
        {
          title: name,
          description:
            "Read or explicitly save Arco settings, unsent drafts, or annotation positions on this device. Contains no source credentials.",
          inputSchema: stateToolSchemas[name],
          annotations: {
            readOnlyHint: [
              "arco_get_settings",
              "arco_read_draft",
              "arco_read_annotation_snapshot",
            ].includes(name),
            openWorldHint: false,
            destructiveHint:
              name === "arco_delete_draft" ||
              name === "arco_delete_annotation_snapshot",
          },
          _meta: { ui: { visibility: ["app"] } },
        },
        async (input: Record<string, unknown>): Promise<CallToolResult> => {
          try {
            let value;
            switch (name) {
              case "arco_read_annotation_snapshot":
                value = await store.readAnnotationSnapshot(
                  annotationSnapshotKeySchema.parse(input).id,
                );
                break;
              case "arco_write_annotation_snapshot":
                value = await store.writeAnnotationSnapshot(
                  annotationSnapshotSchema.parse(input),
                );
                break;
              case "arco_delete_annotation_snapshot":
                value = await store.deleteAnnotationSnapshot(
                  annotationSnapshotKeySchema.parse(input).id,
                );
                break;
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
            return dataResult(value, "empty");
          } catch (error) {
            return failureResult(
              error,
              "Unable to save locally. Keep your current input.",
              "storage",
            );
          }
        },
      );
    },
  );
}
