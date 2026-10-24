import { z } from "zod";
import {
  listInputSchema,
  repoSchema,
  type IssuePage,
  type IssueSummary,
  type ListInput,
} from "../../shared/contracts.js";
import { GitHubError, parse } from "./transport";

const pageSize = 100;
const searchLimit = 1000;

// Search uses the same lexical engine as the existing REST endpoint. Selecting
// summary fields here also keeps issue bodies off the GitHub -> gh connection.
const repositoryIssuesQuery = `query ArcoRepositoryIssues($query: String!, $after: String) {
  search(query: $query, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on Issue {
        id number title state updatedAt url
        author { login }
        repository { nameWithOwner }
        labels(first: 100) {
          nodes { id name color }
          pageInfo { hasNextPage }
        }
        assignees(first: 100) {
          nodes { login }
          pageInfo { hasNextPage }
        }
      }
    }
  }
}`;

const nestedPageInfoSchema = z.object({ hasNextPage: z.boolean() });
const issueSchema = z.object({
  __typename: z.literal("Issue"),
  id: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED"]),
  updatedAt: z.string(),
  url: z.url(),
  author: z.object({ login: z.string() }).nullable(),
  repository: z.object({ nameWithOwner: repoSchema }),
  labels: z.object({
    nodes: z
      .array(z.object({ id: z.string(), name: z.string(), color: z.string() }))
      .max(pageSize),
    pageInfo: nestedPageInfoSchema,
  }),
  assignees: z.object({
    nodes: z.array(z.object({ login: z.string() })).max(pageSize),
    pageInfo: nestedPageInfoSchema,
  }),
});

const responseSchema = z.object({
  data: z.object({
    search: z.object({
      issueCount: z.number().int().nonnegative(),
      pageInfo: z.object({
        hasNextPage: z.boolean(),
        endCursor: z.string().min(1).nullable(),
      }),
      nodes: z
        .array(
          z.discriminatedUnion("__typename", [
            issueSchema,
            z.object({ __typename: z.literal("PullRequest") }),
          ]),
        )
        .max(pageSize),
    }),
  }),
});

function compatibleQuery(query: string): boolean {
  // A query's sort qualifier can override the separately supplied REST sort.
  // Keep that behavior and the legacy parser's Boolean syntax handling intact.
  return !/(^|\s)-?sort\s*:|(^|\s)(AND|OR|NOT)(?=\s|$)|[()]/i.test(query);
}

function issueSummary(
  repo: string,
  issue: z.infer<typeof issueSchema>,
): IssueSummary {
  const url = new URL(issue.url);
  if (
    url.origin !== "https://github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.toLowerCase() !==
      `/${issue.repository.nameWithOwner}/issues/${issue.number}`.toLowerCase()
  )
    throw new GitHubError(
      "GitHub returned conflicting issue repository identities.",
    );
  return {
    repo,
    number: issue.number,
    source: "github",
    id: issue.id,
    title: issue.title,
    state: issue.state === "OPEN" ? "open" : "closed",
    updatedAt: issue.updatedAt,
    url: issue.url,
    author: issue.author?.login ?? "ghost",
    // Label IDs are opaque to list consumers. Detail and editing metadata keep
    // their existing REST IDs and are fetched independently on selection.
    labels: issue.labels.nodes,
    assignees: issue.assignees.nodes.map((person) => person.login),
  };
}

export function createRepositoryIssueReader(options: {
  query: (
    query: string,
    variables: Record<string, unknown>,
  ) => Promise<unknown>;
  legacyList: (input: ListInput) => Promise<IssuePage>;
}) {
  return {
    async list(raw: ListInput): Promise<IssuePage> {
      const input = listInputSchema.parse(raw);
      if (
        !compatibleQuery(input.query) ||
        input.page * pageSize > searchLimit ||
        (input.page > 1 && !input.cursor)
      )
        return options.legacyList(input);
      if (input.page === 1 && input.cursor)
        throw new GitHubError(
          "Refresh the issue list before continuing to its next page.",
          "invalid",
        );
      const state = input.state === "all" ? "" : `is:${input.state}`;
      const query =
        `repo:${input.repo} is:issue ${state} ${input.query}`.trim() +
        ` sort:${input.sort ?? "updated"}-${input.order ?? "desc"}`;
      const rawResponse = await options.query(repositoryIssuesQuery, {
        query,
        after: input.cursor ?? null,
      });
      // A partial GraphQL response must never be presented as a complete list.
      if (
        rawResponse &&
        typeof rawResponse === "object" &&
        "errors" in rawResponse
      )
        throw new GitHubError(
          "GitHub search did not complete. Narrow your search and try again.",
        );
      const { search } = parse(responseSchema, rawResponse).data;
      const issues = search.nodes.filter(
        (node): node is z.infer<typeof issueSchema> =>
          node.__typename === "Issue" &&
          node.repository.nameWithOwner.toLowerCase() ===
            input.repo.toLowerCase(),
      );
      // Labels/assignees must remain complete. Fall back this page and its
      // subsequent page-only continuation rather than silently truncating them.
      if (
        issues.some(
          (issue) =>
            issue.labels.pageInfo.hasNextPage ||
            issue.assignees.pageInfo.hasNextPage,
        )
      )
        return options.legacyList(input);
      const hasMore =
        search.pageInfo.hasNextPage &&
        input.page * pageSize < Math.min(search.issueCount, searchLimit);
      if (
        hasMore &&
        (!search.pageInfo.endCursor ||
          search.pageInfo.endCursor === input.cursor ||
          search.nodes.length === 0)
      )
        throw new GitHubError("GitHub returned an invalid issue search page.");
      return {
        issues: issues.map((issue) => issueSummary(input.repo, issue)),
        hasMore,
        page: input.page,
        ...(hasMore ? { nextCursor: search.pageInfo.endCursor! } : {}),
      };
    },
  };
}
