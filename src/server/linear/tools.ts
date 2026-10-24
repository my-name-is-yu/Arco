import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  linearSchemas,
  type LinearService,
  type LinearToolName,
} from "../../shared/linear";
import { dataResult, failureResult, imageResult } from "../tool-results";

export const linearReadOnly = new Set<LinearToolName>([
  "linear_auth_status",
  "linear_connection",
  "linear_scopes",
  "linear_metadata",
  "linear_list_issues",
  "linear_get_issue",
  "linear_comments",
  "linear_resolve_issue",
  "linear_read_image",
  "linear_templates",
]);
export function registerLinearTools(server: McpServer, service: LinearService) {
  for (const name of Object.keys(linearSchemas) as LinearToolName[]) {
    server.registerTool(
      name,
      {
        title: name,
        description:
          name === "linear_resolve_issue"
            ? "Resolve an official Linear issue URL through the authorized connection and return its native workspace, team, and issue IDs. Read-only; rejects a different workspace or canonical issue."
            : `Linear native Issue operation: ${name}. Uses the selected connection, workspace and team. Workflow state is never synthesized from GitHub.`,
        inputSchema: linearSchemas[name].shape,
        annotations: {
          readOnlyHint: linearReadOnly.has(name),
          destructiveHint: !linearReadOnly.has(name),
          openWorldHint: true,
        },
        _meta:
          name.startsWith("linear_auth_") ||
          name === "linear_upload" ||
          name === "linear_read_image"
            ? { ui: { visibility: ["app"] } }
            : {},
      },
      async (input: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const response = await service.call(name, input);
          if (name === "linear_read_image") return imageResult(response);
          return dataResult(response);
        } catch (error) {
          return failureResult(error, "The Linear operation failed.");
        }
      },
    );
  }
}
