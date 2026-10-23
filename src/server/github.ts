import { spawn } from "node:child_process";
import { z } from "zod";
import {
  GitHubProjectsError,
  readProjectFields,
  readProjectMemberships,
} from "./github-projects";
import {
  accountIssuesInputSchema,
  commentInputSchema,
  commentsInputSchema,
  createInputSchema,
  issueRefSchema,
  labelInputSchema,
  listInputSchema,
  projectInputSchema,
  repositoriesInputSchema,
  repoSchema,
  updateInputSchema,
  type GitHubService,
  type Comment,
  type CommentPage,
  type CommentsInput,
  type IssueDetail,
  type IssueRef,
  type IssueSummary,
  type Label,
  type ProjectInput,
  type ProjectStatus,
} from "../shared/contracts.js";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly code = "unavailable",
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Only public gh commands are launched; credentials remain owned by gh. */
export type GhRunner = (args: string[], input?: string) => Promise<unknown>;

function commandError(stderr: string): GitHubError {
  if (/HTTP 401|not logged|authentication|gh auth login/i.test(stderr)) {
    return new GitHubError(
      "Unable to connect to GitHub. Check gh auth login in your terminal.",
      "auth",
    );
  }
  if (
    /HTTP 403|insufficient|required scopes|read:project|Resource not accessible/i.test(
      stderr,
    )
  ) {
    return new GitHubError(
      "Permission denied. Check the target and your GitHub CLI permissions.",
      "forbidden",
    );
  }
  if (/HTTP 404/i.test(stderr))
    return new GitHubError(
      "The target was not found, or you do not have permission to view it.",
      "not-found",
    );
  return new GitHubError(
    "Unable to reach GitHub. Check your connection and refresh.",
  );
}

export const runGh: GhRunner = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
    let stdout = "";
    let stderr = "";
    let exceeded = false;
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 8 * 1024 * 1024) {
        exceeded = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code === "ENOENT"
          ? new GitHubError(
              "GitHub CLI was not found. Install gh using the instructions at cli.github.com.",
              "missing-cli",
            )
          : new GitHubError("Unable to start GitHub CLI."),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || exceeded) {
        reject(commandError(stderr));
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : null);
      } catch {
        reject(new GitHubError("Unable to read the response from GitHub."));
      }
    });
    // A closed stdin must never become an uncaught process error.
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });

const apiLabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
});
const apiIssueSchema = z.object({
  node_id: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  updated_at: z.string(),
  html_url: z.string(),
  user: z.object({ login: z.string() }).nullable(),
  labels: z.array(apiLabelSchema),
  assignees: z.array(z.object({ login: z.string() })),
  body: z.string().nullable().optional(),
  state_reason: z.string().nullable().optional(),
  pull_request: z.unknown().optional(),
  repository_url: z.string().optional(),
  type: z
    .object({ id: z.number().int().positive(), name: z.string() })
    .nullable()
    .optional(),
});
const apiCommentSchema = z.object({
  id: z.number().int().positive().optional(),
  node_id: z.string(),
  body: z.string(),
  user: z.object({ login: z.string() }).nullable(),
  html_url: z.string(),
  updated_at: z.string(),
  issue_url: z.string().optional(),
});
const apiRepositorySchema = z.object({
  node_id: z.string(),
  full_name: repoSchema,
  html_url: z.url(),
  private: z.boolean(),
  archived: z.boolean(),
  has_issues: z.boolean(),
});
const PROJECT_MUTATION = `mutation ArcoProjectStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
    value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } }
}`;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new GitHubError("GitHub returned an unexpected response format.");
  return result.data;
}

function labelDto(label: z.infer<typeof apiLabelSchema>): Label {
  return { id: String(label.id), name: label.name, color: label.color };
}

function commentDto(comment: z.infer<typeof apiCommentSchema>): Comment {
  return {
    id: comment.node_id,
    ...(comment.id !== undefined ? { databaseId: comment.id } : {}),
    body: comment.body,
    author: comment.user?.login ?? "ghost",
    url: comment.html_url,
    updatedAt: comment.updated_at,
  };
}

function summary(
  repo: string,
  issue: z.infer<typeof apiIssueSchema>,
): IssueSummary {
  if (issue.pull_request !== undefined)
    throw new GitHubError("This target is not an issue.", "invalid");
  return {
    repo,
    number: issue.number,
    source: "github",
    id: issue.node_id,
    title: issue.title,
    state: issue.state,
    updatedAt: issue.updated_at,
    url: issue.html_url,
    author: issue.user?.login ?? "ghost",
    labels: issue.labels.map(labelDto),
    assignees: issue.assignees.map((person) => person.login),
  };
}

function accountIssueRepo(issue: z.infer<typeof apiIssueSchema>): string {
  const match = /^https:\/\/api\.github\.com\/repos\/([^/?#]+\/[^/?#]+)$/i.exec(
    issue.repository_url ?? "",
  );
  const repo = repoSchema.safeParse(match?.[1]);
  if (!repo.success)
    throw new GitHubError(
      "GitHub returned an issue without a valid repository identity.",
    );
  const parsedUrl = z.url().safeParse(issue.html_url);
  if (!parsedUrl.success)
    throw new GitHubError("GitHub returned an invalid issue URL.");
  const sourceUrl = new URL(parsedUrl.data);
  if (
    sourceUrl.origin !== "https://github.com" ||
    sourceUrl.username ||
    sourceUrl.password ||
    sourceUrl.search ||
    sourceUrl.hash ||
    sourceUrl.pathname.toLowerCase() !==
      `/${repo.data}/issues/${issue.number}`.toLowerCase()
  )
    throw new GitHubError(
      "GitHub returned conflicting issue repository identities.",
    );
  return repo.data;
}

/** Retains settled failures too: a timed out write must never be replayed automatically. */
export function createWriteGuard<T = IssueDetail>(limit = 256) {
  const requests = new Map<
    string,
    { payload: string; promise: Promise<T>; settled: boolean }
  >();
  return (
    requestId: string,
    payload: unknown,
    write: () => Promise<T>,
  ): Promise<T> => {
    const key = JSON.stringify(payload);
    const previous = requests.get(requestId);
    if (previous) {
      if (previous.payload !== key)
        return Promise.reject(
          new GitHubError(
            "This requestId was already used for a different change.",
            "conflict",
          ),
        );
      return previous.promise;
    }
    if (requests.size >= limit) {
      const removable = [...requests].find(([, value]) => value.settled);
      if (!removable)
        return Promise.reject(
          new GitHubError(
            "Changes are still being processed. Wait for them to finish.",
          ),
        );
      requests.delete(removable[0]);
    }
    const entry = {
      payload: key,
      promise: Promise.resolve().then(write),
      settled: false,
    };
    requests.set(requestId, entry);
    void entry.promise.then(
      () => {
        entry.settled = true;
      },
      () => {
        entry.settled = true;
      },
    );
    return entry.promise;
  };
}

export function validateProjectStatus(
  issue: IssueDetail,
  input: ProjectInput,
): ProjectStatus {
  const field = issue.projects.find(
    (project) =>
      project.projectId === input.projectId &&
      project.itemId === input.itemId &&
      project.fieldId === input.fieldId,
  );
  if (!field || !field.options.some((option) => option.id === input.optionId)) {
    throw new GitHubError(
      "The issue, Project, field, and option do not match. Refresh and select them again.",
      "invalid",
    );
  }
  return field;
}

export function createGitHubService(
  options: { run?: GhRunner; defaultRepo?: string | null } = {},
): GitHubService {
  const run = options.run ?? runGh;
  const defaultRepo = options.defaultRepo
    ? repoSchema.parse(options.defaultRepo)
    : null;
  const once = createWriteGuard();

  async function api(
    endpoint: string,
    method = "GET",
    body?: unknown,
    paginate = false,
    write = false,
  ): Promise<unknown> {
    const args = [
      "api",
      "--hostname",
      "github.com",
      endpoint,
      "--method",
      method,
      "--header",
      "Accept: application/vnd.github+json",
    ];
    if (paginate) args.push("--paginate", "--slurp");
    if (body !== undefined) args.push("--input", "-");
    let value: unknown;
    try {
      value = await run(
        args,
        body === undefined ? undefined : JSON.stringify(body),
      );
    } catch (error) {
      if (write)
        throw new GitHubError(
          "Unable to confirm the GitHub update. Check GitHub and refresh before retrying.",
          "uncertain",
        );
      throw error instanceof GitHubError
        ? error
        : new GitHubError("Unable to reach GitHub.");
    }
    if (value && typeof value === "object" && "errors" in value) {
      throw new GitHubError(
        write
          ? "Unable to confirm the Projects update. Refresh to check the result."
          : "Unable to load Projects. Check the read:project permission in GitHub CLI.",
        write ? "uncertain" : "forbidden",
      );
    }
    return value;
  }

  async function issueRecord(input: IssueRef) {
    const issue = parse(
      apiIssueSchema,
      await api(`repos/${input.repo}/issues/${input.number}`),
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
        api("graphql", "POST", { query, variables });
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
      api(`repos/${repo}/labels?per_page=100`, "GET", undefined, true),
      api(`repos/${repo}/assignees?per_page=100`, "GET", undefined, true),
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
    async connection() {
      try {
        const user = parse(z.object({ login: z.string() }), await api("user"));
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
      const endpoint = `search/issues?q=${encodeURIComponent(query)}&sort=${input.sort ?? "updated"}&order=${input.order ?? "desc"}&per_page=30&page=${input.page}`;
      const response = parse(
        z.object({
          total_count: z.number(),
          incomplete_results: z.boolean(),
          items: z.array(apiIssueSchema),
        }),
        await api(endpoint),
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
        hasMore: input.page * 30 < Math.min(response.total_count, 1000),
        page: input.page,
      };
    },
    async accountIssues(raw) {
      const input = accountIssuesInputSchema.parse(raw);
      const response = parse(
        z.array(apiIssueSchema),
        await api(
          `issues?filter=${input.filter}&state=${input.state}&sort=${input.sort}&direction=${input.order}&per_page=30&page=${input.page}`,
        ),
      );
      return {
        issues: response
          .filter((issue) => issue.pull_request === undefined)
          .map((issue) => summary(accountIssueRepo(issue), issue)),
        // A full native page may have a next page. Filtering PRs must not hide it.
        hasMore: response.length === 30,
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
        await api(`repos/${input.repo}/issues/comments/${id}`),
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
    update(raw) {
      const input = updateInputSchema.parse(raw);
      return once(input.requestId, ["update", input], async () => {
        if (!Object.keys(input.patch).length)
          throw new GitHubError("Select the fields to change.", "invalid");
        const latest = await issueRecord(input);
        if (input.expectedUpdatedAt) {
          if (latest.updated_at !== input.expectedUpdatedAt)
            throw new GitHubError(
              "This issue has changed elsewhere. Keep your draft and refresh.",
              "conflict",
            );
        }
        const { stateReason, ...patch } = input.patch;
        await api(
          `repos/${input.repo}/issues/${input.number}`,
          "PATCH",
          {
            ...patch,
            ...(stateReason !== undefined ? { state_reason: stateReason } : {}),
          },
          false,
          true,
        );
        const saved = await refreshAfterWrite(input);
        if (
          input.patch.assignees !== undefined &&
          JSON.stringify(
            [
              ...new Set(
                input.patch.assignees.map((login) => login.toLowerCase()),
              ),
            ].sort(),
          ) !==
            JSON.stringify(
              saved.assignees.map((login) => login.toLowerCase()).sort(),
            )
        ) {
          throw new GitHubError(
            "The saved assignees do not match your selection. Check your permissions and refresh.",
            "not-applied",
          );
        }
        return saved;
      });
    },
    labels(raw) {
      const input = labelInputSchema.parse(raw);
      return once(input.requestId, ["labels", input], async () => {
        if (
          input.add.some((add) =>
            input.remove.some(
              (remove) => add.toLowerCase() === remove.toLowerCase(),
            ),
          )
        ) {
          throw new GitHubError(
            "The same label cannot be added and removed in one change.",
            "invalid",
          );
        }
        const [issue, choices] = await Promise.all([
          issueRecord(input),
          metadata(input.repo),
        ]);
        if (
          input.add.some(
            (name) =>
              !choices.labels.some(
                (label) => label.name.toLowerCase() === name.toLowerCase(),
              ),
          )
        ) {
          throw new GitHubError(
            "Select labels that already exist in this repository.",
            "invalid",
          );
        }
        const add = input.add.filter(
          (name) =>
            !issue.labels.some(
              (label) => label.name.toLowerCase() === name.toLowerCase(),
            ),
        );
        if (add.length)
          await api(
            `repos/${input.repo}/issues/${input.number}/labels`,
            "POST",
            { labels: add },
            false,
            true,
          );
        for (const name of input.remove) {
          const existing = issue.labels.find(
            (label) => label.name.toLowerCase() === name.toLowerCase(),
          );
          if (existing)
            await api(
              `repos/${input.repo}/issues/${input.number}/labels/${encodeURIComponent(existing.name)}`,
              "DELETE",
              undefined,
              false,
              true,
            );
        }
        return refreshAfterWrite(input);
      });
    },
    comment(raw) {
      const input = commentInputSchema.parse(raw);
      return once(input.requestId, ["comment", input], async () => {
        await issueRecord(input);
        const posted = parse(
          apiCommentSchema,
          await api(
            `repos/${input.repo}/issues/${input.number}/comments`,
            "POST",
            { body: input.body },
            false,
            true,
          ),
        );
        return {
          ...(await refreshAfterWrite(input)),
          postedComment: commentDto(posted),
        };
      });
    },
    create(raw) {
      const input = createInputSchema.parse(raw);
      return once(input.requestId, ["create", input], async () => {
        let issueType: { id: number; name: string } | undefined;
        if (input.issueTypeName !== undefined) {
          const repository = parse(
            z.object({
              owner: z.object({ login: z.string(), type: z.string() }),
            }),
            await api(`repos/${input.repo}`),
          );
          if (repository.owner.type !== "Organization")
            throw new GitHubError(
              "Issue types are available only in organization repositories. Remove the template type default or create the issue on GitHub.",
              "invalid",
            );
          const types = parse(
            z.array(
              z.object({ id: z.number().int().positive(), name: z.string() }),
            ),
            await api(`orgs/${repository.owner.login}/issue-types`),
          );
          const matches = types.filter(
            (type) =>
              type.name.toLowerCase() === input.issueTypeName?.toLowerCase(),
          );
          if (matches.length !== 1)
            throw new GitHubError(
              "The template issue type is not an existing type in this organization. Refresh the template or remove its type default.",
              "invalid",
            );
          issueType = matches[0];
        }
        if (input.labels !== undefined || input.assignees !== undefined) {
          const choices = await metadata(input.repo);
          if (
            input.labels?.some(
              (name) =>
                !choices.labels.some(
                  (label) => label.name.toLowerCase() === name.toLowerCase(),
                ),
            ) ||
            input.assignees?.some(
              (name) =>
                !choices.assignees.some(
                  (login) => login.toLowerCase() === name.toLowerCase(),
                ),
            )
          ) {
            throw new GitHubError(
              "Select existing labels and eligible assignees in the target repository.",
              "invalid",
            );
          }
        }
        const created = parse(
          apiIssueSchema,
          await api(
            `repos/${input.repo}/issues`,
            "POST",
            {
              title: input.title,
              body: input.body,
              ...(issueType ? { type: issueType.name } : {}),
              ...(input.labels !== undefined ? { labels: input.labels } : {}),
              ...(input.assignees !== undefined
                ? { assignees: input.assignees }
                : {}),
            },
            false,
            true,
          ),
        );
        let saved: IssueDetail;
        try {
          saved = await refreshAfterWrite({
            repo: input.repo,
            number: created.number,
          });
        } catch {
          throw new GitHubError(
            `Issue ${input.repo} #${created.number} was created, but its details could not be refreshed. Check ${created.html_url} and do not create it again.`,
            "refresh",
          );
        }
        if (
          (issueType !== undefined && saved.issueType?.id !== issueType.id) ||
          input.labels?.some(
            (name) =>
              !saved.labels.some(
                (label) => label.name.toLowerCase() === name.toLowerCase(),
              ),
          ) ||
          input.assignees?.some(
            (name) =>
              !saved.assignees.some(
                (login) => login.toLowerCase() === name.toLowerCase(),
              ),
          )
        ) {
          throw new GitHubError(
            `Issue #${saved.number} was created, but some selected attributes were not applied. Check ${saved.url}.`,
            "not-applied",
          );
        }
        return saved;
      });
    },
    projectStatus(raw) {
      const input = projectInputSchema.parse(raw);
      return once(input.requestId, ["projectStatus", input], async () => {
        validateProjectStatus(await get(input), input);
        await api(
          "graphql",
          "POST",
          {
            query: PROJECT_MUTATION,
            variables: {
              projectId: input.projectId,
              itemId: input.itemId,
              fieldId: input.fieldId,
              optionId: input.optionId,
            },
          },
          false,
          true,
        );
        return refreshAfterWrite(input);
      });
    },
  };
}

/** Bulk preserves each issue's outcome and never retries a failed member. */
export async function runBulk<T>(
  items: readonly IssueRef[],
  operation: (issue: IssueRef) => Promise<T>,
) {
  const outcomes: (
    | { issue: IssueRef; ok: true; value: T }
    | { issue: IssueRef; ok: false; error: string }
  )[] = [];
  for (const issue of items) {
    try {
      outcomes.push({ issue, ok: true, value: await operation(issue) });
    } catch (error) {
      outcomes.push({
        issue,
        ok: false,
        error:
          error instanceof GitHubError
            ? error.message
            : "The operation failed.",
      });
    }
  }
  return outcomes;
}
