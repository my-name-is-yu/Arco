import { readFile, mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  OpenAIUiResourceMetadataSchema,
  OpenAIUiToolMetadataSchema,
  OpenAIMentionSearchResultSchema,
} from "@openai/mcp-extensions";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { issueRefSchema } from "../shared/contracts";
import { createGitHubService } from "./github";
import { createFixtureService } from "./fixture";
import { callDataTool, dataSchemas, type DataToolName } from "./tools";
import { createStateStore } from "./state";
import { registerStateTools } from "./state-tools";
import { createGitHubOperations } from "./github-operations";
import { registerGitHubOperationTools } from "./github-operation-tools";
import { createFixtureGitHubOperations } from "./github-operations-fixture";
import { createLinearService } from "./linear/service";
import { createLinearFixtureService } from "./linear/fixture";
import { registerLinearTools } from "./linear/tools";
import { createMentionSearch } from "./mentions";
import { linearRefSchema } from "../shared/linear";
import { registerGitHubImageTool } from "./images";
import { z } from "zod";

declare const __ARCO_FIXTURE__: boolean;
const service = __ARCO_FIXTURE__
  ? createFixtureService()
  : createGitHubService({ defaultRepo: process.env.ARCO_GITHUB_REPO });
const server = new McpServer(
  { name: "Arco", version: "0.1.0" },
  {
    capabilities: {
      extensions: { "openai/mentions": { searchTool: "search_mentions" } },
      experimental: { "openai/mentions": { searchTool: "search_mentions" } },
    },
  },
);
const uri = "ui://arco/issues";
const fixtureState = __ARCO_FIXTURE__
  ? await mkdtemp(join(tmpdir(), "arco-fixture-state-"))
  : undefined;
if (fixtureState)
  process.on("exit", () => {
    rmSync(fixtureState, { recursive: true, force: true });
  });
const stateStore = createStateStore(fixtureState);
registerStateTools(server, stateStore);
registerGitHubImageTool(server, service, { fixture: __ARCO_FIXTURE__ });
registerGitHubOperationTools(
  server,
  __ARCO_FIXTURE__
    ? createFixtureGitHubOperations({ service })
    : createGitHubOperations({ service }),
);
const linearService = __ARCO_FIXTURE__
  ? createLinearFixtureService()
  : createLinearService();
registerLinearTools(server, linearService);
const searchMentions = createMentionSearch(service, linearService, stateStore);
const readOnly = new Set<DataToolName>([
  "arco_connection",
  "arco_list_issues",
  "arco_account_issues",
  "arco_repositories",
  "arco_get_issue",
  "arco_repo_metadata",
  "search_mentions",
]);
function result(value: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: { ...value },
  };
}
function failure(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : "The operation failed.",
      },
    ],
  };
}

registerAppResource(
  server,
  "arco",
  uri,
  {
    description: "GitHub and Linear Issues with explicit Codex context sharing",
  },
  async () => ({
    contents: [
      {
        uri,
        mimeType: RESOURCE_MIME_TYPE,
        text: await readFile(new URL("./arco.html", import.meta.url), "utf8"),
        _meta: {
          "openai/ui": OpenAIUiResourceMetadataSchema.parse({
            availableDisplayModes: ["inline", "fullscreen"],
            preferredDisplayMode: "fullscreen",
          }),
          ui: {
            csp: { connectDomains: [], resourceDomains: [] },
            prefersBorder: false,
          },
        },
      },
    ],
  }),
);
registerAppTool(
  server,
  "arco_open",
  {
    title: "Arco",
    description:
      "Open Arco Issue browser. Browsing does not send messages or change issues.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    _meta: {
      ui: { resourceUri: uri },
      "openai/ui": OpenAIUiToolMetadataSchema.parse({
        entrypoints: [{ type: "global" }, { type: "thread" }],
        preferredModelDisplayMode: "inline",
      }),
    },
  },
  async () => result(await service.connection()),
);

const descriptions: Record<DataToolName, string> = {
  arco_connection:
    "Check existing public gh connection. Never returns credentials.",
  arco_list_issues:
    "List GitHub issues in an explicit repository. Excludes pull requests.",
  arco_account_issues:
    "List connected-account issues without repository input. Default assigned; explicit created, mentioned, or all accessible filters. Supports state/sort/page, not full-text search; excludes pull requests. A full page may require one final empty page request.",
  arco_repositories:
    "Discover repositories the authenticated account can explicitly access as owner, collaborator or organization member, 30 at a time. Does not scan repository issues or search public GitHub.",
  arco_get_issue:
    "Read one GitHub issue, body, comments, and separate Projects statuses.",
  arco_repo_metadata: "Read repository labels and eligible assignees.",
  arco_update_issue:
    "Edit only supplied issue fields. expectedUpdatedAt detects known conflicts. A requestId is reusable only for the identical action; writes are never automatically retried.",
  arco_change_labels:
    "Add/remove specified labels, preserving all unspecified labels.",
  arco_comment:
    "Post one comment. Reuse the SAME requestId for the same operation; ambiguous writes must be checked before retrying.",
  arco_create_issue:
    "Create an issue in the specified repo. Reuse the same requestId on duplicate invocation.",
  arco_project_status:
    "Change an existing Project item single-select value. Requires matching project, item, field and option IDs. Does not close/reopen the issue.",
  search_mentions:
    "Search native Issue resources for composer @Arco. Use source:github repo:owner/name or source:linear team:key to choose a scope; otherwise use the saved Arco scope.",
};
// Keep each schema intact while using the standard v1 registration API.
for (const name of Object.keys(dataSchemas) as DataToolName[]) {
  server.registerTool(
    name,
    {
      title: name,
      description: descriptions[name],
      inputSchema: dataSchemas[name].shape,
      ...(name === "search_mentions"
        ? { outputSchema: OpenAIMentionSearchResultSchema.shape }
        : {}),
      annotations: {
        readOnlyHint: readOnly.has(name),
        destructiveHint: !readOnly.has(name),
        idempotentHint: readOnly.has(name),
        openWorldHint: true,
      },
      _meta:
        name === "search_mentions"
          ? {
              "openai/extensions": { "mentions/search": {} },
              ui: { visibility: ["app"] },
            }
          : {},
    },
    async (args: Record<string, unknown>) => {
      try {
        const response = result(
          await (name === "search_mentions"
            ? searchMentions(args)
            : callDataTool(service, name, args)),
        );
        if (name === "search_mentions") response.content = [];
        if (!readOnly.has(name)) {
          const parsed = issueRefSchema.safeParse(response.structuredContent);
          if (parsed.success)
            await server.server
              .sendResourceUpdated({
                uri: `issue://github/${parsed.data.repo}/${parsed.data.number}`,
              })
              .catch(() => undefined);
        }
        return response;
      } catch (error) {
        return failure(error);
      }
    },
  );
}
server.registerResource(
  "github-issue",
  new ResourceTemplate("issue://github/{owner}/{repo}/{number}", {
    list: undefined,
  }),
  {
    mimeType: "text/markdown",
    description: "Explicitly selected GitHub Issue context",
  },
  async (resourceUri, variables) => {
    const ref = issueRefSchema.parse({
      repo: `${variables.owner}/${variables.repo}`,
      number: Number(variables.number),
    });
    const issue = await service.get(ref);
    return {
      contents: [
        {
          uri: resourceUri.href,
          mimeType: "text/markdown",
          text: `${issue.repo} #${issue.number}: ${issue.title}\n${issue.url}\nState: ${issue.state}\n\n${issue.body}`,
        },
      ],
    };
  },
);
server.registerResource(
  "linear-issue",
  new ResourceTemplate(
    "issue://linear/{connectionId}/{workspaceId}/{teamId}/{issueId}",
    { list: undefined },
  ),
  {
    mimeType: "text/markdown",
    description: "Explicitly selected Linear Issue context",
  },
  async (resourceUri, variables) => {
    const ref = linearRefSchema.parse(variables);
    const issue = z
      .object({
        identifier: z.string(),
        title: z.string(),
        body: z.string(),
        url: z.string(),
        state: z.object({ name: z.string() }),
      })
      .parse(await linearService.call("linear_get_issue", ref));
    return {
      contents: [
        {
          uri: resourceUri.href,
          mimeType: "text/markdown",
          text: `${issue.identifier}: ${issue.title}\n${issue.url}\nWorkflow state: ${issue.state.name}\n\n${issue.body}`,
        },
      ],
    };
  },
);
await server.connect(new StdioServerTransport());
