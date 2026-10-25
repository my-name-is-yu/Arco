import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  githubOperationSchemas,
  type GitHubOperationToolName,
} from "../shared/github-operations";
import {
  callGitHubOperation,
  createGitHubOperations,
  githubOperationReadOnly,
} from "./github-operations";
import { dataResult, failureResult } from "./tool-results";

export function registerGitHubOperationTools(
  server: McpServer,
  operations: ReturnType<typeof createGitHubOperations>,
) {
  (Object.keys(githubOperationSchemas) as GitHubOperationToolName[]).forEach(
    (name) => {
      server.registerTool(
        name,
        {
          title: name,
          description: `GitHub native Issue operation: ${name}. Source IDs/scopes remain distinct. Changes only explicitly supplied attributes; requestId deduplicates this action within the process.`,
          inputSchema: githubOperationSchemas[name].shape,
          annotations: {
            readOnlyHint: githubOperationReadOnly.has(name),
            destructiveHint: !githubOperationReadOnly.has(name),
            openWorldHint: true,
          },
        },
        async (args: Record<string, unknown>): Promise<CallToolResult> => {
          try {
            return dataResult(
              await callGitHubOperation(operations, name, args),
            );
          } catch (error) {
            return failureResult(error, "The GitHub operation failed.");
          }
        },
      );
    },
  );
}
