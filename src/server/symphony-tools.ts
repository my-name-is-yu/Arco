import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { symphonyToolSchemas, type SymphonyService } from "../shared/symphony";
import { dataResult, failureResult } from "./tool-results";

export function registerSymphonyTools(
  server: McpServer,
  service: SymphonyService,
) {
  (
    Object.keys(symphonyToolSchemas) as (keyof typeof symphonyToolSchemas)[]
  ).forEach((name) => {
    server.registerTool(
      name,
      {
        title: name,
        description:
          name === "arco_symphony_test_connection"
            ? "Test the official Symphony observability HTTP API through an existing connection route. Does not save settings or change the runtime."
            : "Read current Symphony runtime observations for an explicitly selected saved connection. A missing runtime does not mean the tracker issue is complete. Does not start, retry, approve, stop, or steer agents.",
        inputSchema: symphonyToolSchemas[name],
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
        ...(name === "arco_symphony_test_connection"
          ? { _meta: { ui: { visibility: ["app"] } } }
          : {}),
      },
      async (input: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          if (name === "arco_symphony_state")
            return dataResult(
              await service.getState(
                symphonyToolSchemas.arco_symphony_state.parse(input),
              ),
            );
          if (name === "arco_symphony_issue")
            return dataResult(
              await service.getIssue(
                symphonyToolSchemas.arco_symphony_issue.parse(input),
              ),
            );
          return dataResult(
            await service.probe(
              symphonyToolSchemas.arco_symphony_test_connection.parse(input),
            ),
            "empty",
          );
        } catch (error) {
          return failureResult(
            error,
            "Unable to read Symphony. Check the existing connection route and try again.",
          );
        }
      },
    );
  });
}
