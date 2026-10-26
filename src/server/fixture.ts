import { OperationError } from "../shared/errors";
import {
  accountIssuesInputSchema,
  commentInputSchema,
  commentsInputSchema,
  createInputSchema,
  issueRefSchema,
  labelInputSchema,
  listInputSchema,
  projectInputSchema,
  repoSchema,
  repositoriesInputSchema,
  updateInputSchema,
  type GitHubService,
  type IssueDetail,
  type IssueRef,
  type IssueSummary,
  type Label,
} from "../shared/contracts.js";
import type { LabelDefinition } from "../shared/github-operations";
import { GitHubError, validateProjectStatus } from "./github.js";
import { createGitHubWriteGuard } from "./github/transport";

export interface FixtureGitHubService extends GitHubService {
  fixture: {
    labels(): LabelDefinition[];
    replaceLabels(labels: LabelDefinition[]): void;
    issues(): IssueDetail[];
    mutate(ref: IssueRef, update: (issue: IssueDetail) => void): IssueDetail;
  };
}

export const FIXTURE_REPO = "yu/Arco";
function listSummary(issue: IssueDetail): IssueSummary {
  return {
    repo: issue.repo,
    number: issue.number,
    source: issue.source,
    id: issue.id,
    title: issue.title,
    state: issue.state,
    updatedAt: issue.updatedAt,
    url: issue.url,
    author: issue.author,
    labels: issue.labels,
    assignees: issue.assignees,
  };
}
/** Explicit development data, isolated from gh and never represented as a live connection. */
export function createFixtureService(): FixtureGitHubService {
  const LABELS: Label[] = [
    { id: "fixture-label-bug", name: "bug", color: "d73a4a" },
    { id: "fixture-label-feature", name: "enhancement", color: "a2eeef" },
    { id: "fixture-label-design", name: "design", color: "c5def5" },
  ];
  const initialIssues: IssueDetail[] = [
    {
      repo: FIXTURE_REPO,
      number: 42,
      source: "github",
      id: "fixture-issue-42",
      title: "Preserve issue selection and scroll position",
      state: "open",
      updatedAt: "2026-10-22T03:30:00Z",
      url: "https://github.com/yu/Arco/issues/42",
      author: "fixture-user",
      labels: [LABELS[1], LABELS[2]],
      assignees: ["fixture-user"],
      body: "## Background\n\nReturn to the same position when switching between issues.\n\n![Fixture selection preview](https://user-images.githubusercontent.com/arco-fixture/selection.png)\n\n## Acceptance criteria\n\n- [x] Show the issue list and details side by side\n- [ ] Preserve filters, selection, and scroll position\n- [ ] Keep unsaved drafts during refresh\n\nThis is local fixture data for testing. It is not a real GitHub issue.",
      stateReason: null,
      comments: [
        {
          id: "fixture-comment-1",
          databaseId: 1,
          body: "Keep the same behavior when switching issues with the keyboard.",
          author: "fixture-reviewer",
          url: "https://github.com/yu/Arco/issues/42#issuecomment-fixture-1",
          updatedAt: "2026-10-22T03:20:00Z",
        },
      ],
      commentsHasMore: false,
      projects: [
        {
          projectId: "fixture-project",
          projectTitle: "Arco implementation",
          itemId: "fixture-item-42",
          fieldId: "fixture-status-field",
          fieldName: "Status",
          optionId: "fixture-status-progress",
          options: [
            { id: "fixture-status-todo", name: "Todo", color: "GRAY" },
            {
              id: "fixture-status-progress",
              name: "In progress",
              color: "BLUE",
            },
            { id: "fixture-status-done", name: "Done", color: "GREEN" },
          ],
        },
      ],
    },
    {
      repo: FIXTURE_REPO,
      number: 43,
      source: "github",
      id: "fixture-issue-43",
      title: "Separate shared context from sending a request",
      state: "open",
      updatedAt: "2026-10-22T03:00:00Z",
      url: "https://github.com/yu/Arco/issues/43",
      author: "fixture-reviewer",
      labels: [LABELS[1]],
      assignees: [],
      body: "## Conversation integration\n\nShare only the necessary parts of an issue body or comments.\n\n@fixture-user, keep selection sharing explicit.\n\n- Share context\n- Prepare a draft in the current conversation\n- Prepare a draft in a new conversation\n- Start the request explicitly\n\nSelecting an issue never sends a message.",
      stateReason: null,
      comments: [],
      commentsHasMore: false,
      projects: [
        {
          projectId: "fixture-project",
          projectTitle: "Arco implementation",
          itemId: "fixture-item-43",
          fieldId: "fixture-status-field",
          fieldName: "Status",
          optionId: "fixture-status-todo",
          options: [
            { id: "fixture-status-todo", name: "Todo", color: "GRAY" },
            {
              id: "fixture-status-progress",
              name: "In progress",
              color: "BLUE",
            },
            { id: "fixture-status-done", name: "Done", color: "GREEN" },
          ],
        },
      ],
    },
    {
      repo: FIXTURE_REPO,
      number: 41,
      source: "github",
      id: "fixture-issue-41",
      title: "Keep Issue state separate from Projects Status",
      state: "closed",
      updatedAt: "2026-10-21T08:00:00Z",
      url: "https://github.com/yu/Arco/issues/41",
      author: "fixture-user",
      labels: [LABELS[0]],
      assignees: [],
      body: "Verify that changing the issue state does not automatically change its Project Status.",
      stateReason: "completed",
      comments: [],
      commentsHasMore: false,
      projects: [],
    },
  ];

  const issues = structuredClone(initialIssues);
  let labelDefinitions: LabelDefinition[] = LABELS.map((label) => ({
    ...structuredClone(label),
    description: "",
  }));
  const createdTimes = new Map(
    issues.map((issue) => [issue.number, Date.parse(issue.updatedAt)]),
  );
  const once = createGitHubWriteGuard<IssueDetail>(async () => "fixture");
  let commentSequence = 1;
  function find(raw: IssueRef): IssueDetail {
    const ref = issueRefSchema.parse(raw);
    const issue = issues.find(
      (candidate) =>
        candidate.repo === ref.repo && candidate.number === ref.number,
    );
    if (!issue)
      throw new GitHubError(
        "This issue is not available in the local fixture.",
        "not-found",
      );
    return issue;
  }
  function touch(issue: IssueDetail): IssueDetail {
    issue.updatedAt = new Date(
      Math.max(Date.now(), Date.parse(issue.updatedAt) + 1),
    ).toISOString();
    return detail(issue);
  }
  function detail(issue: IssueDetail): IssueDetail {
    return {
      ...structuredClone(issue),
      comments: structuredClone(issue.comments.slice(0, 30)),
      commentsHasMore: issue.comments.length > 30,
      commentsNextPage: issue.comments.length > 30 ? 2 : undefined,
    };
  }
  return {
    fixture: {
      labels: () => structuredClone(labelDefinitions),
      replaceLabels(labels) {
        labelDefinitions = structuredClone(labels);
        for (const issue of issues)
          issue.labels = issue.labels.flatMap((assigned) => {
            const definition = labelDefinitions.find(
              (label) => label.id === assigned.id,
            );
            return definition ? [structuredClone(definition)] : [];
          });
      },
      issues: () => structuredClone(issues),
      mutate(ref, update) {
        const issue = find(ref);
        update(issue);
        return touch(issue);
      },
    },
    authGeneration: async () => "fixture-github-session",
    async connection() {
      return {
        mode: "fixture",
        connected: true,
        account: "fixture-user",
        authGeneration: "fixture-github-session",
        message:
          "Local fixture. Changes are stored in memory and are not sent to GitHub.",
      };
    },
    async list(raw) {
      const input = listInputSchema.parse(raw);
      if (input.cursor && input.cursor !== `fixture:${input.page - 1}`)
        throw new OperationError(
          "Invalid fixture issue cursor. Refresh the list.",
          "invalid-input",
        );
      const matches = issues
        .filter(
          (issue) =>
            issue.repo === input.repo &&
            (input.state === "all" || input.state === issue.state) &&
            `${issue.title}\n${issue.body}\n${issue.number}`
              .toLowerCase()
              .includes(input.query.toLowerCase()),
        )
        .sort((a, b) => {
          const value =
            input.sort === "comments"
              ? a.comments.length - b.comments.length
              : input.sort === "created"
                ? (createdTimes.get(a.number) ?? 0) -
                  (createdTimes.get(b.number) ?? 0)
                : a.updatedAt.localeCompare(b.updatedAt);
          return (
            (input.order === "asc" ? 1 : -1) * (value || a.number - b.number)
          );
        });
      return {
        issues: structuredClone(
          matches
            .slice((input.page - 1) * 100, input.page * 100)
            .map(listSummary),
        ),
        hasMore: matches.length > input.page * 100 && input.page < 10,
        page: input.page,
        ...(matches.length > input.page * 100 && input.page < 10
          ? { nextCursor: `fixture:${input.page}` }
          : {}),
      };
    },
    async accountIssues(raw) {
      const input = accountIssuesInputSchema.parse(raw);
      const matches = issues
        .filter((issue) => input.state === "all" || issue.state === input.state)
        .filter((issue) => {
          if (input.filter === "all") return true;
          if (input.filter === "assigned")
            return issue.assignees.includes("fixture-user");
          if (input.filter === "created")
            return issue.author === "fixture-user";
          return [
            issue.body,
            ...issue.comments.map((comment) => comment.body),
          ].some((body) => /@fixture-user(?![A-Za-z0-9-])/i.test(body));
        })
        .sort((a, b) => {
          const value =
            input.sort === "comments"
              ? a.comments.length - b.comments.length
              : input.sort === "created"
                ? (createdTimes.get(a.number) ?? 0) -
                  (createdTimes.get(b.number) ?? 0)
                : a.updatedAt.localeCompare(b.updatedAt);
          return (
            (input.order === "asc" ? 1 : -1) * (value || a.number - b.number)
          );
        });
      return {
        issues: structuredClone(
          matches
            .slice((input.page - 1) * 100, input.page * 100)
            .map(listSummary),
        ),
        hasMore: matches.length > input.page * 100,
        page: input.page,
        scope: "account",
        filter: input.filter,
      };
    },
    async repositories(raw) {
      const input = repositoriesInputSchema.parse(raw);
      return {
        repositories:
          input.page === 1
            ? [
                {
                  id: "fixture-repository-arco",
                  repo: FIXTURE_REPO,
                  url: `https://github.com/${FIXTURE_REPO}`,
                  private: false,
                  archived: false,
                  issuesEnabled: true,
                },
              ]
            : [],
        hasMore: false,
        page: input.page,
      };
    },
    async get(raw) {
      return detail(find(raw));
    },
    async comments(raw) {
      const input = commentsInputSchema.parse(raw);
      const issue = find(input);
      const hasMore = issue.comments.length > input.page * 30;
      return {
        comments: structuredClone(
          issue.comments.slice((input.page - 1) * 30, input.page * 30),
        ),
        hasMore,
        ...(hasMore ? { nextPage: input.page + 1 } : {}),
      };
    },
    async readMarkdown(raw, commentId) {
      const issue = find(raw);
      if (commentId === undefined) return issue.body;
      const comment = issue.comments.find(
        (comment) => comment.databaseId === commentId,
      );
      if (!comment)
        throw new GitHubError(
          "This comment does not belong to the selected issue.",
          "invalid",
        );
      return comment.body;
    },
    async metadata(rawRepo) {
      if (repoSchema.parse(rawRepo) !== FIXTURE_REPO)
        throw new GitHubError(
          "The fixture repository is yu/Arco.",
          "not-found",
        );
      return {
        labels: structuredClone(labelDefinitions),
        assignees: ["fixture-user", "fixture-reviewer"],
      };
    },
    update(raw) {
      const input = updateInputSchema.parse(raw);
      return once(input.requestId, ["update", input], async () => {
        const issue = find(input);
        if (
          input.expectedUpdatedAt &&
          input.expectedUpdatedAt !== issue.updatedAt
        )
          throw new GitHubError(
            "This issue has changed elsewhere. Keep your draft and refresh.",
            "conflict",
          );
        if (!Object.keys(input.patch).length)
          throw new GitHubError("Select the fields to change.", "invalid");
        if (
          input.patch.assignees?.some(
            (login) => !["fixture-user", "fixture-reviewer"].includes(login),
          )
        ) {
          throw new GitHubError(
            "Select an eligible assignee in this fixture.",
            "invalid",
          );
        }
        if (input.patch.title !== undefined) issue.title = input.patch.title;
        if (input.patch.body !== undefined) issue.body = input.patch.body;
        if (input.patch.state !== undefined) issue.state = input.patch.state;
        if (input.patch.stateReason !== undefined)
          issue.stateReason = input.patch.stateReason;
        if (input.patch.assignees !== undefined)
          issue.assignees = [...new Set(input.patch.assignees)];
        return touch(issue);
      });
    },
    labels(raw) {
      const input = labelInputSchema.parse(raw);
      return once(input.requestId, ["labels", input], async () => {
        const issue = find(input);
        if (
          input.add.some((add) =>
            input.remove.some(
              (remove) => remove.toLowerCase() === add.toLowerCase(),
            ),
          )
        )
          throw new GitHubError(
            "The same label cannot be added and removed in one change.",
            "invalid",
          );
        const additions = input.add.map((name) => {
          const label = labelDefinitions.find(
            (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
          );
          if (!label)
            throw new GitHubError(
              "Select labels that already exist in this repository.",
              "invalid",
            );
          return label;
        });
        issue.labels = issue.labels.filter(
          (label) =>
            !input.remove.some(
              (name) => name.toLowerCase() === label.name.toLowerCase(),
            ),
        );
        for (const label of additions)
          if (!issue.labels.some((existing) => existing.id === label.id))
            issue.labels.push(structuredClone(label));
        return touch(issue);
      });
    },
    comment(raw) {
      const input = commentInputSchema.parse(raw);
      return once(input.requestId, ["comment", input], async () => {
        const issue = find(input);
        commentSequence =
          Math.max(
            commentSequence,
            ...issue.comments.map((comment) => comment.databaseId ?? 0),
          ) + 1;
        const id = `fixture-comment-${commentSequence}`;
        const postedComment = {
          id,
          databaseId: commentSequence,
          body: input.body,
          author: "fixture-user",
          url: `${issue.url}#${id}`,
          updatedAt: new Date().toISOString(),
        };
        issue.comments.push(postedComment);
        return {
          ...touch(issue),
          postedComment: structuredClone(postedComment),
        };
      });
    },
    create(raw) {
      const input = createInputSchema.parse(raw);
      return once(input.requestId, ["create", input], async () => {
        if (input.repo !== FIXTURE_REPO)
          throw new GitHubError(
            "The fixture repository is yu/Arco.",
            "not-found",
          );
        if (
          (input.issueTypeName !== undefined &&
            !["Task", "Bug"].includes(input.issueTypeName)) ||
          input.labels?.some(
            (name) => !labelDefinitions.some((label) => label.name === name),
          ) ||
          input.assignees?.some(
            (name) => !["fixture-user", "fixture-reviewer"].includes(name),
          )
        )
          throw new GitHubError(
            "Select existing labels and assignees in this fixture.",
            "invalid",
          );
        const number = Math.max(...issues.map((issue) => issue.number)) + 1;
        const issue: IssueDetail = {
          repo: FIXTURE_REPO,
          number,
          source: "github",
          id: `fixture-issue-${number}`,
          title: input.title,
          body: input.body,
          issueType: input.issueTypeName
            ? {
                id: input.issueTypeName === "Bug" ? 2 : 1,
                name: input.issueTypeName,
                color: input.issueTypeName === "Bug" ? "red" : "blue",
              }
            : null,
          state: "open",
          stateReason: null,
          author: "fixture-user",
          updatedAt: new Date().toISOString(),
          url: `https://github.com/yu/Arco/issues/${number}`,
          labels: labelDefinitions
            .filter((label) => input.labels?.includes(label.name))
            .map((label) => structuredClone(label)),
          assignees: [...(input.assignees ?? [])],
          comments: [],
          commentsHasMore: false,
          projects: [],
        };
        issues.push(issue);
        createdTimes.set(issue.number, Date.parse(issue.updatedAt));
        return structuredClone(issue);
      });
    },
    projectStatus(raw) {
      const input = projectInputSchema.parse(raw);
      return once(input.requestId, ["projectStatus", input], async () => {
        const issue = find(input);
        const project = validateProjectStatus(issue, input);
        project.optionId = input.optionId;
        return touch(issue);
      });
    },
  };
}
