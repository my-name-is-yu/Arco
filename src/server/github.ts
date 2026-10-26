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
import { createRepositoryIssueReader } from "./github/issue-list";
import { createConditionalReader } from "./github/conditional-read";
import { credentialIdentity } from "./github/credential-identity";
import {
  createGitHubAuthSession,
  type GitHubAuthSession,
} from "./github/auth-session";
import {
  createGitHubTransport,
  createGitHubWriteGuard,
  GitHubError,
  parse,
  runGh,
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
    credentialIdentity?: () => Promise<string>;
    authSession?: GitHubAuthSession;
  } = {},
): GitHubService {
  const run = options.run;
  const identity = options.credentialIdentity ?? credentialIdentity;
  const authSession = options.authSession ?? createGitHubAuthSession(identity);
  const once = createGitHubWriteGuard<IssueDetail>(authSession.read);

  const transport = createGitHubTransport({ run, policy: "core" });
  const api = transport.request;
  const conditional = createConditionalReader({ run: run ?? runGh });

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
    return get(input).catch(() => {
      throw new GitHubError(
        "The change was saved to GitHub, but refresh failed. Keep your draft and refresh again.",
        "refresh",
      );
    });
  }

  async function readLabels(repo: string) {
    return parse(
      z.array(z.array(apiLabelSchema)),
      await api(
        "read",
        `repos/${repo}/labels?per_page=100`,
        "GET",
        undefined,
        true,
      ),
    )
      .flat()
      .map(labelDto);
  }

  async function metadata(rawRepo: string) {
    const repo = repoSchema.parse(rawRepo);
    const [labels, assignees] = await Promise.all([
      readLabels(repo),
      api(
        "read",
        `repos/${repo}/assignees?per_page=100`,
        "GET",
        undefined,
        true,
      ),
    ]);
    return {
      labels,
      assignees: parse(
        z.array(z.array(z.object({ login: z.string() }))),
        assignees,
      )
        .flat()
        .map((person) => person.login),
    };
  }

  const repositoryIssues = createRepositoryIssueReader({
    query: (query, variables) =>
      transport.query(query, variables).catch((error) => {
        throw new GitHubError(
          "Unable to load repository issues. Check GitHub access and refresh.",
          error instanceof GitHubError ? error.code : "unavailable",
        );
      }),
  });

  return {
    authGeneration: authSession.read,
    ...createIssueWrites({
      api,
      once,
      issueRecord,
      readLabels,
      metadata,
      get,
      refreshAfterWrite,
    }),
    async connection() {
      try {
        const authGeneration = await authSession.read();
        const user = parse(
          z.object({ login: z.string(), id: z.number().int().positive() }),
          await api("read", "user"),
        );
        if (authGeneration !== (await authSession.read()))
          throw new GitHubError(
            "GitHub authentication changed. Refresh to verify the current account.",
            "auth",
          );
        return {
          mode: "github",
          connected: true,
          account: user.login,
          authGeneration,
          userId: String(user.id),
          message: "Connected using your existing GitHub CLI authentication.",
        };
      } catch (error) {
        return {
          mode: "github",
          connected: false,
          account: null,
          authGeneration: authSession.current(),
          userId: null,
          message:
            error instanceof GitHubError
              ? error.message
              : "Unable to connect to GitHub.",
        };
      }
    },
    async list(raw) {
      return repositoryIssues.list(listInputSchema.parse(raw));
    },
    async accountIssues(raw) {
      const input = accountIssuesInputSchema.parse(raw);
      const generation = await authSession.read();
      const response = parse(
        z.array(apiIssueSummarySchema),
        await conditional.read(
          `issues?filter=${input.filter}&state=${input.state}&sort=${input.sort}&direction=${input.order}&per_page=${issuePageSize}&page=${input.page}`,
          `[.[] | ${issueSummaryProjection}]`,
          generation,
        ),
      );
      if (generation !== (await authSession.read())) {
        conditional.clear();
        throw new GitHubError(
          "GitHub authentication changed while loading issues. Refresh and try again.",
          "auth",
        );
      }
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
