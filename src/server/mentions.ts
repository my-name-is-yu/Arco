import { z } from "zod";
import {
  OpenAIMentionSearchParamsSchema,
  OpenAIMentionSearchResultSchema,
} from "@openai/mcp-extensions";
import type { GitHubService } from "../shared/contracts";
import type { LinearService } from "../shared/linear";
import { listInputSchema } from "../shared/contracts";
import type { createStateStore } from "./state";

const linearScopes = z.object({
  workspace: z.object({ id: z.string() }),
  teams: z.array(z.object({ id: z.string(), key: z.string() })),
});
const linearPage = z.object({
  issues: z.array(
    z.object({
      connectionId: z.string(),
      workspaceId: z.string(),
      teamId: z.string(),
      issueId: z.string(),
      identifier: z.string(),
      title: z.string(),
      state: z.object({ name: z.string() }),
    }),
  ),
});
export function linearResourceUri(ref: {
  connectionId: string;
  workspaceId: string;
  teamId: string;
  issueId: string;
}) {
  return `issue://linear/${[ref.connectionId, ref.workspaceId, ref.teamId, ref.issueId].map(encodeURIComponent).join("/")}`;
}
export function createMentionSearch(
  github: GitHubService,
  linear: LinearService,
  state: ReturnType<typeof createStateStore>,
) {
  return async (raw: unknown) => {
    const { query } = OpenAIMentionSearchParamsSchema.parse(raw);
    const repoMatch = /(?:^|\s)repo:([\w.-]+\/[\w.-]+)(?:\s|$)/.exec(query);
    const requestedLinear =
      /(?:^|\s)source:linear(?:\s|$)/i.test(query) ||
      /^linear(?:\s|$)/i.test(query);
    const requestedGithub =
      /(?:^|\s)source:github(?:\s|$)/i.test(query) || Boolean(repoMatch);
    if (requestedLinear && requestedGithub)
      throw new Error("Choose one source for Issue search.");
    const settings = (await state.readSettings()).settings;
    const clean = query
      .replace(/(?:^|\s)source:(?:github|linear)(?=\s|$)/gi, "")
      .replace(/^linear(?:\s+|$)/i, "")
      .trim();
    if (
      requestedLinear ||
      (!requestedGithub && settings.activeSource === "linear")
    ) {
      const scopes = linearScopes.parse(
        await linear.call("linear_scopes", { connectionId: "default" }),
      );
      const teamMatch = /(?:^|\s)team:([^\s]+)/.exec(clean);
      const team = teamMatch
        ? scopes.teams.find(
            (team) => team.id === teamMatch[1] || team.key === teamMatch[1],
          )
        : settings.activeLinearTeam
          ? scopes.teams.find((team) => team.id === settings.activeLinearTeam)
          : scopes.teams.length === 1
            ? scopes.teams[0]
            : undefined;
      if (!team) throw new Error("Choose a Linear team to search.");
      const page = linearPage.parse(
        await linear.call("linear_list_issues", {
          connectionId: "default",
          workspaceId: scopes.workspace.id,
          teamId: team.id,
          query: clean.replace(/(?:^|\s)team:[^\s]+/g, "").trim(),
        }),
      );
      return OpenAIMentionSearchResultSchema.parse({
        items: page.issues.map((issue) => ({
          type: "resource",
          resourceUri: linearResourceUri(issue),
          title: `${issue.identifier} ${issue.title}`,
          subtitle: `Linear · ${issue.state.name}`,
        })),
      });
    }
    const connection = await github.connection();
    const repo =
      repoMatch?.[1] ?? settings.activeGithubRepo ?? connection.defaultRepo;
    if (!repo)
      throw new Error(
        "Specify repo:owner/name or choose a scope in Arco before using @Arco search.",
      );
    const page = await github.list(
      listInputSchema.parse({
        repo,
        query: clean.replace(/(?:^|\s)repo:[\w.-]+\/[\w.-]+/g, "").trim(),
        state: "all",
      }),
    );
    return OpenAIMentionSearchResultSchema.parse({
      items: page.issues.map((issue) => ({
        type: "resource",
        resourceUri: `issue://github/${issue.repo}/${issue.number}`,
        title: `${issue.repo} #${issue.number} ${issue.title}`,
        subtitle: `GitHub · ${issue.state}`,
      })),
    });
  };
}
