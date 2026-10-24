import { PaginationOrderBy } from "@linear/sdk";
import { z } from "zod";
import { linearIssueUrl } from "../../shared/issue-url";
import type { LinearPage } from "../../shared/linear";
import type { Args, IssueFilter, LinearOperation } from "./operation";

const fields = `
  organization { id urlKey }
  team(id: $teamId) { id organization { id } }
`;
const pageFields = `
  nodes {
    id identifier title url updatedAt
    team { id }
    state { id name type color }
  }
  pageInfo { hasNextPage endCursor }
`;
const issuesQuery = `
  query ArcoLinearIssueList(
    $teamId: String!, $filter: IssueFilter, $first: Int!,
    $after: String, $orderBy: PaginationOrderBy
  ) {
    ${fields}
    issuePage: issues(
      filter: $filter, first: $first, after: $after, orderBy: $orderBy
    ) { ${pageFields} }
  }
`;
const searchQuery = `
  query ArcoLinearIssueSearch(
    $teamId: String!, $filter: IssueFilter, $first: Int!,
    $after: String, $orderBy: PaginationOrderBy, $term: String!
  ) {
    ${fields}
    issuePage: searchIssues(
      term: $term, teamId: $teamId, includeComments: true,
      filter: $filter, first: $first, after: $after, orderBy: $orderBy
    ) { ${pageFields} }
  }
`;

const id = z.string().min(1).max(200);
const responseSchema = z.object({
  organization: z.object({
    id,
    urlKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  }),
  team: z.object({ id, organization: z.object({ id }) }),
  issuePage: z.object({
    nodes: z
      .array(
        z.object({
          id,
          identifier: z.string().regex(/^[A-Za-z0-9]+-[1-9]\d*$/),
          title: z.string(),
          url: z.string().max(2048),
          updatedAt: z.iso.datetime({ offset: true }),
          team: z.object({ id }),
          state: z.object({
            id,
            name: z.string().min(1),
            type: z.string().min(1),
            color: z.string().min(1),
          }),
        }),
      )
      .max(100),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().min(1).max(200).nullable(),
    }),
  }),
});

export function createLinearIssueReader({
  auth,
  makeClient,
}: Pick<LinearOperation, "auth" | "makeClient">) {
  return async function list(
    input: Args<"linear_list_issues">,
  ): Promise<LinearPage> {
    const filter: IssueFilter = {
      team: { id: { eq: input.teamId } },
      ...(input.stateId ? { state: { id: { eq: input.stateId } } } : {}),
      ...(input.assigneeId
        ? { assignee: { id: { eq: input.assigneeId } } }
        : {}),
      ...(input.labelId
        ? { labels: { some: { id: { eq: input.labelId } } } }
        : {}),
      ...(input.projectId ? { project: { id: { eq: input.projectId } } } : {}),
    };
    const searching = Boolean(input.query.trim());
    let raw: unknown;
    try {
      const client = makeClient(await auth.accessToken(input.connectionId));
      raw = await client.client.request(searching ? searchQuery : issuesQuery, {
        teamId: input.teamId,
        filter,
        first: 100,
        ...(input.cursor ? { after: input.cursor } : {}),
        orderBy:
          input.order === "createdAt"
            ? PaginationOrderBy.CreatedAt
            : PaginationOrderBy.UpdatedAt,
        ...(searching ? { term: input.query } : {}),
      });
    } catch {
      // SDK errors can include the request, search text, and source response.
      throw new Error(
        "Unable to load Linear issues. Check access and refresh.",
      );
    }
    const parsed = responseSchema.safeParse(raw);
    if (
      !parsed.success ||
      (typeof raw === "object" && raw !== null && "errors" in raw)
    )
      throw new Error(
        "Linear returned an incomplete issue list. Refresh and try again.",
      );
    const { organization, team, issuePage } = parsed.data;
    if (
      organization.id !== input.workspaceId ||
      team.id !== input.teamId ||
      team.organization.id !== input.workspaceId
    )
      throw new Error(
        "The selected Linear workspace or team does not match this connection.",
      );
    const ids = new Set<string>();
    for (const issue of issuePage.nodes) {
      let canonical: ReturnType<typeof linearIssueUrl>;
      try {
        canonical = linearIssueUrl(issue.url);
      } catch {
        throw new Error("Linear returned an invalid issue identity.");
      }
      if (
        ids.has(issue.id) ||
        issue.team.id !== input.teamId ||
        canonical.workspace !== organization.urlKey.toLowerCase() ||
        canonical.identifier !== issue.identifier.toUpperCase() ||
        (input.stateId && issue.state.id !== input.stateId)
      )
        throw new Error(
          "Linear returned a mismatched issue identity or scope.",
        );
      ids.add(issue.id);
    }
    const { hasNextPage, endCursor } = issuePage.pageInfo;
    if (
      hasNextPage &&
      (!issuePage.nodes.length || !endCursor || endCursor === input.cursor)
    )
      throw new Error(
        "Linear issue pagination did not advance. Refresh and try again.",
      );
    return {
      issues: issuePage.nodes.map((issue) => ({
        connectionId: input.connectionId,
        workspaceId: input.workspaceId,
        teamId: input.teamId,
        issueId: issue.id,
        source: "linear",
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        updatedAt: new Date(issue.updatedAt).toISOString(),
        state: issue.state,
      })),
      hasMore: hasNextPage,
      cursor: endCursor,
    };
  };
}
