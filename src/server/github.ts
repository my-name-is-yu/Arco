import { z } from "zod";
import {
  accountIssuesInputSchema,
  commentsInputSchema,
  issueRefSchema,
  listInputSchema,
  repoSchema,
  repositoriesInputSchema,
  type CommentPage,
  type CommentsInput,
  type GitHubService,
  type IssueDetail,
  type IssueRef,
  type ProjectStatus,
} from "../shared/contracts.js";
import {
  GitHubProjectsError,
  readProjectFields,
  readProjectMemberships,
} from "./github-projects";
import {
  accountIssueRepo,
  apiCommentSchema,
  apiIssueSchema,
  apiIssueSummarySchema,
  apiLabelSchema,
  apiRepositorySchema,
  commentDto,
  labelDto,
  summary,
} from "./github/issue-model";
import { createIssueWrites } from "./github/issue-writes";
import {
  createGitHubTransport,
  createGitHubWriteGuard,
  GitHubError,
  parse,
  type GhRunner,
} from "./github/transport";
export { validateProjectStatus } from "./github/issue-writes";
export { GitHubError, runGh, type GhRunner } from "./github/transport";

const issuePageSize = 100;
// gh still receives the native REST response; only summary fields cross stdout
// into the server. Preserve every item and its PR marker for native pagination.
const issueSummaryProjection = `{
  node_id, number, title, state, updated_at, html_url,
  user: (.user | if . == null then null else {login} end),
  labels: [.labels[] | {id, name, color}],
  assignees: [.assignees[] | {login}]
} + (if has("repository_url") then {repository_url} else {} end)
  + (if has("pull_request") then {pull_request: {}} else {} end)`;

export function createGitHubService(
  options: {
    run?: GhRunner;
    defaultRepo?: string | null;
  } = {},
): GitHubService {
  const run = options.run;
  const defaultRepo = options.defaultRepo
    ? repoSchema.parse(options.defaultRepo)
    : null;
  const once = createGitHubWriteGuard<IssueDetail>();

  const transport = createGitHubTransport({ run, policy: "core" });
  const api = transport.request;

  async function issueRecord(input: IssueRef) {
    const issue = parse(
      apiIssueSchema,
      await api("read", `repos/${input.repo}/issues/${input.number}`),
    );
    if (issue.pull_request !== undefined)
      throw new GitHubError("This target is not an issue.", "invalid");
    if (
      issue.number !== input.number ||
      (issue.repository_url !== undefined &&
        issue.repository_url.toLowerCase() !==
          `https://api.github.com/repos/${input.repo}`.toLowerCase())
    ) {
      throw new GitHubError(
        "The issue repository or number has changed. Check its new location on GitHub.",
        "conflict",
      );
    }
    return issue;
  }

  async function projects(
    input: IssueRef,
    issueId: string,
  ): Promise<{ projects: ProjectStatus[]; projectsError?: string }> {
    try {
      const graphql = (query: string, variables: Record<string, unknown>) =>
        api("read", "graphql", "POST", { query, variables });
      const memberships = await readProjectMemberships(graphql, input, issueId);
      const result: ProjectStatus[] = [];
      for (const membership of memberships) {
        const fields = await readProjectFields(graphql, {
          projectId: membership.projectId,
          itemId: membership.itemId,
          issueId,
        });
        for (const field of fields) {
          if (field.type !== "single_select" || field.name !== "Status")
            continue;
          result.push({
            projectId: membership.projectId,
            projectTitle: membership.title,
            itemId: membership.itemId,
            fieldId: field.id,
            fieldName: field.name,
            optionId: typeof field.value === "string" ? field.value : null,
            options: field.options,
          });
        }
      }
      return { projects: result };
    } catch (error) {
      return {
        projects: [],
        projectsError:
          error instanceof GitHubProjectsError
            ? error.message
            : "Unable to load Projects. Check read:project in GitHub CLI and your access to the target.",
      };
    }
  }

  async function commentPage(input: CommentsInput): Promise<CommentPage> {
    const comments = parse(
      z.array(apiCommentSchema),
      await api(
        "read",
        `repos/${input.repo}/issues/${input.number}/comments?per_page=30&page=${input.page}`,
      ),
    );
    const hasMore = comments.length === 30;
    return {
      comments: comments.map(commentDto),
      hasMore,
      ...(hasMore ? { nextPage: input.page + 1 } : {}),
    };
  }

  async function get(raw: IssueRef): Promise<IssueDetail> {
    const input = issueRefSchema.parse(raw);
    const issueRequest = issueRecord(input);
    const [issue, comments, projectData] = await Promise.all([
      issueRequest,
      commentPage({ ...input, page: 1 }),
      issueRequest.then((issue) => projects(input, issue.node_id)),
    ]);
    return {
      ...summary(input.repo, issue),
      body: issue.body ?? "",
      issueType: issue.type ?? null,
      stateReason: issue.state_reason ?? null,
      comments: comments.comments,
      commentsHasMore: comments.hasMore,
      commentsNextPage: comments.nextPage,
      ...projectData,
    };
  }

  async function refreshAfterWrite(input: IssueRef): Promise<IssueDetail> {
    try {
      return await get(input);
    } catch {
      throw new GitHubError(
        "The change was saved to GitHub, but refresh failed. Keep your draft and refresh again.",
        "refresh",
      );
    }
  }

  async function metadata(rawRepo: string) {
    const repo = repoSchema.parse(rawRepo);
    const [labels, assignees] = await Promise.all([
      api("read", `repos/${repo}/labels?per_page=100`, "GET", undefined, true),
      api(
        "read",
        `repos/${repo}/assignees?per_page=100`,
        "GET",
        undefined,
        true,
      ),
    ]);
    return {
      labels: parse(z.array(z.array(apiLabelSchema)), labels)
        .flat()
        .map(labelDto),
      assignees: parse(
        z.array(z.array(z.object({ login: z.string() }))),
        assignees,
      )
        .flat()
        .map((person) => person.login),
    };
  }

  return {
    ...createIssueWrites({
      api,
      once,
      issueRecord,
      metadata,
      get,
      refreshAfterWrite,
    }),
    async connection() {
      try {
        const user = parse(
          z.object({ login: z.string() }),
          await api("read", "user"),
        );
        return {
          mode: "github",
          connected: true,
          account: user.login,
          message: "Connected using your existing GitHub CLI authentication.",
          defaultRepo,
        };
      } catch (error) {
        return {
          mode: "github",
          connected: false,
          account: null,
          message:
            error instanceof GitHubError
              ? error.message
              : "Unable to connect to GitHub.",
          defaultRepo,
        };
      }
    },
    async list(raw) {
      const input = listInputSchema.parse(raw);
      const state = input.state === "all" ? "" : `is:${input.state}`;
      const query =
        `repo:${input.repo} is:issue ${state} ${input.query}`.trim();
      const endpoint = `search/issues?q=${encodeURIComponent(query)}&sort=${input.sort ?? "updated"}&order=${input.order ?? "desc"}&per_page=${issuePageSize}&page=${input.page}`;
      const response = parse(
        z.object({
          total_count: z.number(),
          incomplete_results: z.boolean(),
          items: z.array(apiIssueSummarySchema),
        }),
        await transport.read(
          endpoint,
          `{total_count, incomplete_results, items: [.items[] | ${issueSummaryProjection}]}`,
        ),
      );
      if (response.incomplete_results)
        throw new GitHubError(
          "GitHub search did not complete. Narrow your search and try again.",
        );
      return {
        issues: response.items
          .filter(
            (issue) =>
              issue.pull_request === undefined &&
              issue.repository_url?.toLowerCase() ===
                `https://api.github.com/repos/${input.repo}`.toLowerCase(),
          )
          .map((issue) => summary(input.repo, issue)),
        hasMore:
          input.page * issuePageSize < Math.min(response.total_count, 1000),
        page: input.page,
      };
    },
    async accountIssues(raw) {
      const input = accountIssuesInputSchema.parse(raw);
      const response = parse(
        z.array(apiIssueSummarySchema),
        await transport.read(
          `issues?filter=${input.filter}&state=${input.state}&sort=${input.sort}&direction=${input.order}&per_page=${issuePageSize}&page=${input.page}`,
          `[.[] | ${issueSummaryProjection}]`,
        ),
      );
      return {
        issues: response
          .filter((issue) => issue.pull_request === undefined)
          .map((issue) => summary(accountIssueRepo(issue), issue)),
        // A full native page may have a next page. Filtering PRs must not hide it.
        hasMore: response.length === issuePageSize,
        page: input.page,
        scope: "account",
        filter: input.filter,
      };
    },
    async repositories(raw) {
      const input = repositoriesInputSchema.parse(raw);
      const response = parse(
        z.array(apiRepositorySchema),
        await api(
          "read",
          `user/repos?affiliation=owner,collaborator,organization_member&visibility=all&sort=updated&direction=desc&per_page=30&page=${input.page}`,
        ),
      );
      for (const repo of response) {
        const url = new URL(repo.html_url);
        if (
          url.origin !== "https://github.com" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname.toLowerCase() !== `/${repo.full_name}`.toLowerCase()
        )
          throw new GitHubError(
            "GitHub returned conflicting repository identities.",
          );
      }
      return {
        repositories: response.map((repo) => ({
          id: repo.node_id,
          repo: repo.full_name,
          url: repo.html_url,
          private: repo.private,
          archived: repo.archived,
          issuesEnabled: repo.has_issues,
        })),
        hasMore: response.length === 30,
        page: input.page,
      };
    },
    get,
    async comments(raw) {
      const input = commentsInputSchema.parse(raw);
      await issueRecord(input);
      return commentPage(input);
    },
    async readMarkdown(raw, commentId) {
      const input = issueRefSchema.parse(raw);
      const issue = await issueRecord(input);
      if (commentId === undefined) return issue.body ?? "";
      const id = z.number().int().positive().parse(commentId);
      const comment = parse(
        apiCommentSchema,
        await api("read", `repos/${input.repo}/issues/comments/${id}`),
      );
      if (
        comment.id !== id ||
        comment.issue_url?.toLowerCase() !==
          `https://api.github.com/repos/${input.repo}/issues/${input.number}`.toLowerCase()
      )
        throw new GitHubError(
          "This comment does not belong to the selected issue.",
          "invalid",
        );
      return comment.body;
    },
    metadata,
  };
}
