import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  OpenAIMentionSearchResultSchema,
  OpenAIUiResourceMetadataSchema,
  OpenAIUiToolMetadataSchema,
} from "@openai/mcp-extensions";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { OperationError } from "../shared/errors";
import iconDark from "../../plugin/assets/icon-dark.svg";
import iconLight from "../../plugin/assets/icon.svg";
import { issueRefSchema } from "../shared/contracts";
import {
  issuePresentationSummarySchema,
  nativeIssueTargetSchema,
  personalLaunchContext,
  type IssuePresentationSummary,
  type NativeIssueTarget,
} from "../shared/launch";
import { linearRefSchema } from "../shared/linear";
import type { ArcoBackend } from "./composition";
import { registerGitHubOperationTools } from "./github-operation-tools";
import { registerGitHubImageTool } from "./images";
import { conversationLaunchKey, resolveProjectLaunch } from "./launch";
import { registerLinearTools } from "./linear/tools";
import { createMentionSearch } from "./mentions";
import { registerStateTools } from "./state-tools";
import { failureResult as failure, dataResult as result } from "./tool-results";
import { callDataTool, dataSchemas, type DataToolName } from "./tools";
export function createArcoServer({
  service,
  stateStore,
  linearService,
  operations,
  fixture,
}: ArcoBackend) {
  const server = new McpServer(
    {
      name: "Arco",
      version: "0.1.0",
      icons: [
        {
          src: `data:image/svg+xml,${encodeURIComponent(iconLight)}`,
          mimeType: "image/svg+xml",
          sizes: ["any"],
          theme: "light",
        },
        {
          src: `data:image/svg+xml,${encodeURIComponent(iconDark)}`,
          mimeType: "image/svg+xml",
          sizes: ["any"],
          theme: "dark",
        },
      ],
    },
    {
      capabilities: {
        extensions: { "openai/mentions": { searchTool: "search_mentions" } },
        experimental: { "openai/mentions": { searchTool: "search_mentions" } },
      },
    },
  );
  const uri = "ui://arco/issues";
  const cardUri = "ui://arco/issue-card";
  registerStateTools(server, stateStore);
  registerGitHubImageTool(server, service, { fixture });
  registerGitHubOperationTools(server, operations);
  registerLinearTools(server, linearService);
  const searchMentions = createMentionSearch(
    service,
    linearService,
    stateStore,
  );
  const readOnly = new Set<DataToolName>([
    "arco_connection",
    "arco_list_issues",
    "arco_account_issues",
    "arco_repositories",
    "arco_get_issue",
    "arco_comments",
    "arco_repo_metadata",
    "search_mentions",
  ]);

  for (const resource of [
    { name: "arco", uri, preferredDisplayMode: "fullscreen" },
    { name: "arco-issue-card", uri: cardUri, preferredDisplayMode: "inline" },
  ] as const) {
    registerAppResource(
      server,
      resource.name,
      resource.uri,
      {
        description:
          "GitHub and Linear Issues with explicit Codex context sharing",
      },
      async () => ({
        contents: [
          {
            uri: resource.uri,
            mimeType: RESOURCE_MIME_TYPE,
            text: await readFile(
              new URL("./arco.html", import.meta.url),
              "utf8",
            ),
            _meta: {
              "openai/ui": OpenAIUiResourceMetadataSchema.parse({
                availableDisplayModes: ["inline", "fullscreen"],
                preferredDisplayMode: resource.preferredDisplayMode,
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
  }

  const issuePresentationInput = z
    .object({ target: nativeIssueTargetSchema })
    .strict();
  const readPresentationIssue = async (target: NativeIssueTarget) => {
    let issue: object;
    let canonical: NativeIssueTarget;
    if (target.source === "github") {
      issue = await service.get({ repo: target.repo, number: target.number });
      canonical = z
        .object({ source: z.literal("github"), ...issueRefSchema.shape })
        .parse(issue);
      if (
        canonical.repo.toLowerCase() !== target.repo.toLowerCase() ||
        canonical.number !== target.number
      )
        throw new OperationError(
          "GitHub returned a different issue than the requested target.",
          "invalid-response",
        );
    } else {
      issue = await linearService.call("linear_get_issue", {
        connectionId: target.connectionId,
        workspaceId: target.workspaceId,
        teamId: target.teamId,
        issueId: target.issueId,
      });
      canonical = z
        .object({ source: z.literal("linear"), ...linearRefSchema.shape })
        .parse(issue);
      if (
        canonical.connectionId !== target.connectionId ||
        canonical.workspaceId !== target.workspaceId ||
        canonical.teamId !== target.teamId ||
        canonical.issueId !== target.issueId
      )
        throw new OperationError(
          "Linear returned a different issue or scope. Use linear_resolve_issue with the official issue URL, then pass its native IDs.",
          "invalid-response",
        );
    }
    return { canonical, issue };
  };
  const presentIssue = async (raw: unknown) => {
    try {
      const { target } = issuePresentationInput.parse(raw);
      const { canonical, issue } = await readPresentationIssue(target);
      return result({
        launch: { ...personalLaunchContext, target: canonical },
        issue,
      });
    } catch (error) {
      return failure(error);
    }
  };
  for (const presentation of [
    {
      name: "arco_show_issue",
      title: "Show issue",
      uri: cardUri,
      mode: "inline",
      description:
        "Show one explicit GitHub or Linear issue as an inline conversation card. Use by default when the user asks to see an issue. Requires its native reference; resolve unknown or ambiguous targets first. Use data tools for analysis or updates, and arco_open_issue only for an explicitly requested detail panel. Does not change issues or chat attachments.",
    },
    {
      name: "arco_open_issue",
      title: "Open issue details",
      uri,
      mode: "fullscreen",
      description:
        "Open one explicit GitHub or Linear issue in the detail panel only when the user requests that panel. Requires its native reference. For a normal request to see an issue, use arco_show_issue; for analysis or updates, use data tools. Does not change issues or chat attachments.",
    },
  ] as const) {
    registerAppTool(
      server,
      presentation.name,
      {
        title: presentation.title,
        description: presentation.description,
        inputSchema: issuePresentationInput,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
        _meta: {
          ui: { resourceUri: presentation.uri },
          "openai/ui": OpenAIUiToolMetadataSchema.parse({
            preferredModelDisplayMode: presentation.mode,
          }),
        },
      },
      presentIssue,
    );
  }
  const issuesPresentationInput = z
    .object({ targets: z.array(nativeIssueTargetSchema).min(2).max(10) })
    .strict();
  registerAppTool(
    server,
    "arco_show_issues",
    {
      title: "Show issues",
      description:
        "Show 2–10 explicit GitHub or Linear issues together with compact inline conversation tabs. Selecting a tab shows that issue's existing card. Preserve the supplied order and native references. Resolve unknown or ambiguous targets first. Use arco_show_issue for one issue, and data tools for analysis or updates. Does not change issues, open a panel, or attach chat context.",
      inputSchema: issuesPresentationInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        ui: { resourceUri: cardUri },
        "openai/ui": OpenAIUiToolMetadataSchema.parse({
          preferredModelDisplayMode: "inline",
        }),
      },
    },
    async (raw) => {
      try {
        const { targets } = issuesPresentationInput.parse(raw);
        const unique = new Map<string, NativeIssueTarget>();
        for (const target of targets) {
          const key =
            target.source === "github"
              ? JSON.stringify([
                  "github",
                  target.repo.toLowerCase(),
                  target.number,
                ])
              : JSON.stringify([
                  "linear",
                  target.connectionId,
                  target.workspaceId,
                  target.teamId,
                  target.issueId,
                ]);
          if (!unique.has(key)) unique.set(key, target);
        }
        if (unique.size < 2)
          throw new OperationError(
            "Choose at least two different issues, or use arco_show_issue for one issue.",
            "invalid-input",
          );
        const issues: IssuePresentationSummary[] = [];
        for (const target of unique.values()) {
          const { issue } = await readPresentationIssue(target);
          // Keep only presentation fields; bodies and comments stay in details.
          const summarySchema =
            issuePresentationSummarySchema.options[
              target.source === "github" ? 0 : 1
            ].strip();
          const summary = summarySchema.safeParse(issue);
          if (!summary.success)
            throw new OperationError(
              "The source returned an invalid issue summary. Refresh to try again.",
              "invalid-response",
            );
          issues.push(summary.data);
        }
        return result({ launch: { ...personalLaunchContext, issues } });
      } catch (error) {
        return failure(error);
      }
    },
  );
  const workspaceOpenInput = z
    .object({ source: z.enum(["github", "linear"]).optional() })
    .strict();
  registerAppTool(
    server,
    "arco_open",
    {
      title: "Arco",
      description:
        "Open the personal issue list and management workspace in the side panel only when explicitly requested. Set source to github or linear for an explicitly requested provider list. To show one issue, use arco_show_issue; for analysis or updates, use data tools. Browsing does not send messages or change issues.",
      inputSchema: workspaceOpenInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: { resourceUri: uri },
        "openai/ui": OpenAIUiToolMetadataSchema.parse({
          entrypoints: [{ type: "global" }],
          preferredModelDisplayMode: "fullscreen",
        }),
      },
    },
    async (raw) => {
      try {
        const { source } = workspaceOpenInput.parse(raw);
        const connection =
          source === "linear"
            ? await linearService.call("linear_connection", {})
            : await service.connection();
        return result({
          ...connection,
          launch: source
            ? { ...personalLaunchContext, source }
            : personalLaunchContext,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  registerAppTool(
    server,
    "arco_open_project",
    {
      title: "Arco",
      description:
        "Open the GitHub repository issue list and management workspace in the side panel only when explicitly requested. Uses client workspace roots when available; otherwise choose a repository for this chat. For a Linear list, use arco_open with source linear. To show one issue, use arco_show_issue; for analysis or updates, use data tools. Browsing does not change files or issues.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: { resourceUri: uri },
        "openai/ui": OpenAIUiToolMetadataSchema.parse({
          entrypoints: [{ type: "thread" }],
          preferredModelDisplayMode: "fullscreen",
        }),
      },
    },
    async (_, extra) => {
      const threadId = extra._meta?.threadId;
      const launch = await resolveProjectLaunch({
        listRoots: server.server.getClientCapabilities()?.roots
          ? async () =>
              (await server.server.listRoots(undefined, { timeout: 5000 }))
                .roots
          : undefined,
      });
      return result({
        ...(await service.connection()),
        launch: {
          ...launch,
          projectKey: launch.projectKey ?? conversationLaunchKey(threadId),
        },
      });
    },
  );

  const descriptions: Record<DataToolName, string> = {
    arco_connection:
      "Check existing public gh connection. Never returns credentials.",
    arco_list_issues:
      "List up to 100 GitHub issue summaries in an explicit repository using GraphQL. For subsequent pages pass nextCursor as cursor and increment page, up to page 10. Boolean expressions and sort qualifiers are unsupported; use simple search qualifiers and the sort/order inputs. Excludes pull requests.",
    arco_account_issues:
      "Read one lightweight native page of up to 100 connected-account entries, then exclude pull requests. Default assigned; explicit created, mentioned, or all accessible filters. Supports state/sort/page, not full-text search. Few or no issues with hasMore means another page is available; a full page may require one final empty page request.",
    arco_repositories:
      "Discover repositories the authenticated account can explicitly access as owner, collaborator or organization member, 30 at a time. Does not scan repository issues or search public GitHub.",
    arco_get_issue:
      "Read one GitHub issue, body, the first 30 comments, and separate Projects statuses. Use arco_comments for subsequent pages.",
    arco_comments:
      "Read one page of 30 comments for the selected GitHub issue. Follow nextPage only when the user requests more comments; a full page may require one final empty page request.",
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

  return server;
}
