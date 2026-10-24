import { OperationError } from "../../shared/errors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { linearIssueUrl } from "../../shared/issue-url";
import {
  linearSchemas,
  type LinearComment,
  type LinearIssue,
  type LinearIssueSummary,
  type LinearMetadata,
  type LinearRef,
  type LinearScope,
  type LinearService,
  type LinearToolName,
} from "../../shared/linear";
import { FIXTURE_IMAGE_URL, readIssueImage } from "../images";
import { createWriteGuard } from "../write-guard";
import { decodeLinearUpload } from "./upload";

export const LINEAR_FIXTURE_SCOPE = {
  connectionId: "default",
  workspaceId: "fixture-linear-workspace",
  teamId: "fixture-linear-team",
};
const userId = "fixture-linear-user";
const named = (id: string, name: string) => ({ id, name });
export function createLinearFixtureService(): LinearService {
  const meta: LinearMetadata = {
    states: [
      {
        ...named("linear-state-todo", "Todo"),
        type: "unstarted",
        color: "#bbc3cc",
      },
      {
        ...named("linear-state-progress", "In Progress"),
        type: "started",
        color: "#f2c94c",
      },
      {
        ...named("linear-state-done", "Done"),
        type: "completed",
        color: "#5e6ad2",
      },
    ],
    members: [
      named(userId, "Fixture user"),
      named("fixture-linear-reviewer", "Fixture reviewer"),
    ],
    labels: [
      {
        ...named("linear-label-design", "Design"),
        color: "#c5def5",
        description: null,
        teamId: LINEAR_FIXTURE_SCOPE.teamId,
        parentId: null,
        isGroup: false,
      },
      {
        ...named("linear-label-bug", "Bug"),
        color: "#d73a4a",
        description: null,
        teamId: null,
        parentId: null,
        isGroup: false,
      },
    ],
    projects: [named("linear-project", "Arco implementation")],
    cycles: [named("linear-cycle", "Cycle 1")],
    milestones: [
      {
        ...named("linear-milestone", "First usable version"),
        projectId: "linear-project",
      },
    ],
    estimateValues: [0, 1, 2, 3, 5, 8],
  };
  const first: LinearIssue = {
    ...LINEAR_FIXTURE_SCOPE,
    source: "linear",
    issueId: "fixture-linear-42",
    identifier: "YU-42",
    title: "Keep Linear workflow states intact",
    body: `## Acceptance criteria\n\n- [ ] Use native Linear states\n- [ ] Keep GitHub Open/Closed separate\n\nThis is fictional local fixture data.\n\n![Fixture illustration](${FIXTURE_IMAGE_URL})`,
    url: "https://linear.app/fixture/issue/YU-42",
    updatedAt: "2026-10-22T10:00:00.000Z",
    author: "Fixture user",
    state: meta.states[1],
    assignee: meta.members[0],
    labels: [meta.labels[0]],
    priority: 2,
    estimate: 3,
    dueDate: null,
    project: meta.projects[0],
    projectMilestone: null,
    cycle: meta.cycles[0],
    parent: null,
    children: [],
    comments: [
      {
        id: "linear-comment-1",
        body: "Keep the parent and reply relationship intact.",
        author: "Fixture reviewer",
        authorId: "fixture-linear-reviewer",
        parentId: null,
        updatedAt: "2026-10-22T09:00:00.000Z",
        url: "https://linear.app/fixture/issue/YU-42#comment-1",
        reactions: [],
      },
    ],
    commentsHasMore: false,
    attachments: [],
    relations: [],
    reactions: [],
  };
  const issues = new Map<string, LinearIssue>([
    [first.issueId, first],
    [
      "fixture-linear-43",
      {
        ...structuredClone(first),
        issueId: "fixture-linear-43",
        identifier: "YU-43",
        title: "Share a Linear issue with the Codex chat",
        labels: [],
        state: meta.states[0],
        comments: [],
        url: "https://linear.app/fixture/issue/YU-43",
      },
    ],
  ]);
  const once = createWriteGuard<object>();
  function scope(value: LinearScope) {
    if (
      value.connectionId !== "default" ||
      value.workspaceId !== LINEAR_FIXTURE_SCOPE.workspaceId ||
      value.teamId !== LINEAR_FIXTURE_SCOPE.teamId
    )
      throw new OperationError(
        "The fixture connection, workspace, or team does not match.",
        "invalid-input",
      );
  }
  function find(value: LinearRef) {
    scope(value);
    const issue = issues.get(value.issueId);
    if (!issue)
      throw new OperationError(
        "This Linear issue does not exist in the fixture.",
        "not-found",
      );
    return issue;
  }
  function touch(issue: LinearIssue) {
    issue.updatedAt = new Date(
      Math.max(Date.now(), Date.parse(issue.updatedAt) + 1),
    ).toISOString();
    return detail(issue);
  }
  function commentsPage(issue: LinearIssue, cursor?: string) {
    const start = cursor
      ? issue.comments.findIndex((comment) => comment.id === cursor) + 1
      : 0;
    if (cursor && start === 0)
      throw new OperationError(
        "The comment cursor is no longer available. Refresh and try again.",
        "invalid-input",
      );
    const comments = issue.comments.slice(start, start + 30);
    return {
      comments: structuredClone(comments),
      hasMore: start + comments.length < issue.comments.length,
      cursor: comments.at(-1)?.id ?? null,
    };
  }
  function detail(issue: LinearIssue): LinearIssue {
    const page = commentsPage(issue);
    return {
      ...structuredClone(issue),
      comments: page.comments,
      commentsHasMore: page.hasMore,
      commentsCursor: page.cursor,
    };
  }
  function patchIssue(
    issue: LinearIssue,
    patch: z.output<typeof linearSchemas.linear_update_issue>["patch"],
  ) {
    const choose = <T extends { id: string }>(
      values: T[],
      id: string | null | undefined,
      field: string,
    ) => {
      if (id === null) return null;
      const value = values.find((item) => item.id === id);
      if (!value)
        throw new OperationError(
          `The source ID for ${field} does not match.`,
          "invalid-input",
        );
      return value;
    };
    if (patch.title !== undefined) issue.title = patch.title;
    if (patch.body !== undefined) issue.body = patch.body;
    if (patch.stateId !== undefined)
      issue.state = choose(meta.states, patch.stateId, "workflow state")!;
    if (patch.assigneeId !== undefined)
      issue.assignee = choose(meta.members, patch.assigneeId, "Assignee");
    if (patch.priority !== undefined) issue.priority = patch.priority;
    if (patch.estimate !== undefined) {
      if (
        patch.estimate !== null &&
        !meta.estimateValues.includes(patch.estimate)
      )
        throw new OperationError(
          "This value is not in the team's estimate scale.",
          "invalid-input",
        );
      issue.estimate = patch.estimate;
    }
    if (patch.dueDate !== undefined) issue.dueDate = patch.dueDate;
    if (patch.projectId !== undefined)
      issue.project = choose(meta.projects, patch.projectId, "Project");
    if (patch.projectMilestoneId !== undefined) {
      const value = choose(
        meta.milestones,
        patch.projectMilestoneId,
        "milestone",
      );
      if (value && value.projectId !== issue.project?.id)
        throw new OperationError(
          "The project and milestone do not match.",
          "invalid-input",
        );
      issue.projectMilestone = value;
    }
    if (patch.cycleId !== undefined)
      issue.cycle = choose(meta.cycles, patch.cycleId, "cycle");
    if (patch.parentId !== undefined) {
      const parent = patch.parentId ? issues.get(patch.parentId) : undefined;
      if (patch.parentId && (!parent || parent.issueId === issue.issueId))
        throw new OperationError(
          "The parent issue is invalid.",
          "invalid-input",
        );
      if (issue.parent) {
        const oldParent = issues.get(issue.parent.id);
        if (oldParent)
          oldParent.children = oldParent.children.filter(
            (child) => child.id !== issue.issueId,
          );
      }
      issue.parent = parent
        ? {
            id: parent.issueId,
            identifier: parent.identifier,
            title: parent.title,
          }
        : null;
      if (parent)
        parent.children.push({
          id: issue.issueId,
          identifier: issue.identifier,
          title: issue.title,
        });
    }
  }
  function labels(issue: LinearIssue, add: string[], remove: string[]) {
    if (add.some((id) => remove.includes(id)))
      throw new OperationError(
        "A label cannot be added and removed in the same operation.",
        "invalid-input",
      );
    const additions = add.map((id) =>
      meta.labels.find((value) => value.id === id),
    );
    if (
      additions.some((value) => !value || value.isGroup) ||
      remove.some((id) => !meta.labels.some((value) => value.id === id))
    )
      throw new OperationError(
        "The source label ID or scope does not match.",
        "invalid-input",
      );
    issue.labels = issue.labels.filter((value) => !remove.includes(value.id));
    for (const value of additions)
      if (value && !issue.labels.some((item) => item.id === value.id))
        issue.labels.push(structuredClone(value));
  }
  async function execute(name: LinearToolName, raw: unknown): Promise<object> {
    if (name === "linear_auth_status")
      return {
        state: "connected",
        connected: true,
        message: "Local fixture data.",
      };
    if (name.startsWith("linear_auth_"))
      throw new OperationError(
        "The fixture does not change real Linear authorization.",
        "unsupported",
      );
    if (name === "linear_connection")
      return {
        connected: true,
        connectionId: "default",
        mode: "fixture",
        account: "Fixture user",
        userId,
        workspace: named(LINEAR_FIXTURE_SCOPE.workspaceId, "Yu (fixture)"),
        message: "Fictional Linear fixture. Changes are local only.",
      };
    if (name === "linear_scopes")
      return {
        workspace: named(LINEAR_FIXTURE_SCOPE.workspaceId, "Yu (fixture)"),
        teams: [{ ...named(LINEAR_FIXTURE_SCOPE.teamId, "Yu"), key: "YU" }],
      };
    if (name === "linear_metadata") {
      scope(linearSchemas[name].parse(raw));
      return structuredClone(meta);
    }
    if (name === "linear_resolve_issue") {
      const input = linearSchemas[name].parse(raw);
      const target = linearIssueUrl(input.url);
      if (
        input.connectionId !== LINEAR_FIXTURE_SCOPE.connectionId ||
        target.workspace !== "fixture"
      )
        throw new OperationError(
          "The fixture connection or workspace does not match this issue URL.",
          "invalid-input",
        );
      const issue = [...issues.values()].find(
        (value) => value.identifier === target.identifier,
      );
      if (!issue)
        throw new OperationError(
          "This Linear issue does not exist in the fixture.",
          "not-found",
        );
      return {
        connectionId: issue.connectionId,
        workspaceId: issue.workspaceId,
        teamId: issue.teamId,
        issueId: issue.issueId,
      };
    }
    if (name === "linear_get_issue")
      return detail(find(linearSchemas[name].parse(raw)));
    if (name === "linear_comments") {
      const input = linearSchemas[name].parse(raw);
      return commentsPage(find(input), input.cursor);
    }
    if (name === "linear_read_image") {
      const input = linearSchemas[name].parse(raw);
      const issue = find(input);
      const markdown = input.commentId
        ? issue.comments.find((comment) => comment.id === input.commentId)?.body
        : issue.body;
      if (markdown === undefined)
        throw new OperationError(
          "The image comment does not belong to this issue.",
          "invalid-input",
        );
      return readIssueImage({ url: input.url, markdown }, { fixture: true });
    }
    if (name === "linear_templates") {
      scope(linearSchemas[name].parse(raw));
      return {
        templates: [
          {
            id: "linear-simple-template",
            name: "Simple issue",
            description: "Description and standard properties",
            supported: true,
            defaults: {
              title: "Template issue",
              body: "## Template description\n\nPreserve this default body.",
              priority: 3,
              labelIds: ["linear-label-design"],
            },
          },
          {
            id: "linear-form-template",
            name: "Issue form",
            description: "Complete in Linear",
            supported: false,
            reason: "Complete form templates in Linear.",
          },
        ],
      };
    }
    if (name === "linear_list_issues") {
      const input = linearSchemas[name].parse(raw);
      scope(input);
      const matches = [...issues.values()]
        .filter(
          (issue) =>
            `${issue.identifier}\n${issue.title}\n${issue.body}\n${issue.comments.map((comment) => comment.body).join("\n")}`.includes(
              input.query,
            ) &&
            (!input.stateId || issue.state.id === input.stateId) &&
            (!input.assigneeId || issue.assignee?.id === input.assigneeId) &&
            (!input.labelId ||
              issue.labels.some((value) => value.id === input.labelId)) &&
            (!input.projectId || issue.project?.id === input.projectId),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const start = input.cursor
        ? matches.findIndex((issue) => issue.issueId === input.cursor) + 1
        : 0;
      if (input.cursor && start === 0)
        throw new OperationError(
          "The issue cursor is no longer available. Refresh and try again.",
          "invalid-input",
        );
      const page = matches.slice(start, start + 100);
      return {
        issues: page.map((issue): LinearIssueSummary => ({
          source: "linear",
          connectionId: issue.connectionId,
          workspaceId: issue.workspaceId,
          teamId: issue.teamId,
          issueId: issue.issueId,
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          updatedAt: issue.updatedAt,
          state: structuredClone(issue.state),
        })),
        hasMore: start + page.length < matches.length,
        cursor: page.at(-1)?.issueId ?? null,
      };
    }
    if (name === "linear_create_issue") {
      const input = linearSchemas[name].parse(raw);
      scope(input);
      if (input.templateId && input.templateId !== "linear-simple-template")
        throw new OperationError(
          "Create an issue from this template in Linear.",
          "unsupported",
        );
      const number = issues.size + 42;
      const issue = {
        ...structuredClone(first),
        issueId: randomUUID(),
        identifier: `YU-${number}`,
        title: input.title,
        body:
          input.body ??
          (input.templateId
            ? "## Template description\n\nPreserve this default body."
            : ""),
        priority: input.templateId ? 3 : 0,
        state: meta.states[0],
        assignee: null,
        labels: input.templateId ? [structuredClone(meta.labels[0])] : [],
        comments: [],
        children: [],
        parent: null,
        relations: [],
        attachments: [],
        reactions: [],
      };
      issues.set(issue.issueId, issue);
      if (input.parentId) patchIssue(issue, { parentId: input.parentId });
      return touch(issue);
    }
    if (name === "linear_update_issue") {
      const input = linearSchemas[name].parse(raw);
      const issue = find(input);
      if (issue.updatedAt !== input.expectedUpdatedAt)
        throw new OperationError(
          "This Linear issue changed elsewhere. Keep your draft and refresh.",
          "conflict",
        );
      const candidate = structuredClone(issue);
      patchIssue(candidate, input.patch);
      issues.set(issue.issueId, candidate);
      return touch(candidate);
    }
    if (name === "linear_change_labels") {
      const input = linearSchemas[name].parse(raw);
      const issue = find(input);
      labels(issue, input.add, input.remove);
      return touch(issue);
    }
    if (name === "linear_label_definition") {
      const input = linearSchemas[name].parse(raw);
      scope(input);
      if (input.action === "create") {
        if (!input.name)
          throw new OperationError(
            "A label name is required.",
            "invalid-input",
          );
        meta.labels.push({
          id: randomUUID(),
          name: input.name,
          color: input.color ?? "#999999",
          description: input.description ?? null,
          teamId: input.scope === "team" ? input.teamId : null,
          isGroup: false,
          parentId: null,
        });
      } else {
        const label = meta.labels.find((item) => item.id === input.labelId);
        if (
          !label ||
          label.teamId !== (input.scope === "team" ? input.teamId : null)
        )
          throw new OperationError(
            "The label scope does not match.",
            "invalid-input",
          );
        if (input.action === "delete") {
          meta.labels = meta.labels.filter((item) => item.id !== input.labelId);
          for (const issue of issues.values())
            issue.labels = issue.labels.filter(
              (item) => item.id !== input.labelId,
            );
        } else {
          if (input.name !== undefined) label.name = input.name;
          if (input.color !== undefined) label.color = input.color;
          if (input.description !== undefined)
            label.description = input.description;
        }
      }
      return structuredClone(meta);
    }
    if (name === "linear_comment") {
      const input = linearSchemas[name].parse(raw);
      const issue = find(input);
      let changedComment: LinearComment | undefined;
      if (input.action === "create") {
        if (
          !input.body ||
          (input.parentId &&
            !issue.comments.some((item) => item.id === input.parentId))
        )
          throw new OperationError(
            "Check the comment body and reply target.",
            "invalid-input",
          );
        issue.comments.push({
          id: randomUUID(),
          body: input.body,
          author: "Fixture user",
          authorId: userId,
          parentId: input.parentId ?? null,
          url: issue.url,
          updatedAt: new Date().toISOString(),
          reactions: [],
        });
        changedComment = issue.comments.at(-1);
      } else {
        const comment = issue.comments.find(
          (item) => item.id === input.commentId,
        );
        if (!comment || comment.authorId !== userId)
          throw new OperationError(
            "You can only change your own comment.",
            "forbidden",
          );
        if (
          input.expectedUpdatedAt &&
          comment.updatedAt !== input.expectedUpdatedAt
        )
          throw new OperationError(
            "This Linear comment changed elsewhere. Keep your draft and refresh.",
            "conflict",
          );
        if (input.action === "delete")
          issue.comments = issue.comments.filter(
            (item) => item.id !== input.commentId,
          );
        else {
          if (!input.body)
            throw new OperationError("A body is required.", "invalid-input");
          comment.body = input.body;
          comment.updatedAt = new Date(
            Math.max(Date.now(), Date.parse(comment.updatedAt) + 1),
          ).toISOString();
          changedComment = comment;
        }
      }
      return {
        ...touch(issue),
        ...(changedComment
          ? { changedComment: structuredClone(changedComment) }
          : {}),
        ...(input.action === "delete"
          ? { deletedCommentId: input.commentId }
          : {}),
      };
    }
    if (name === "linear_reaction") {
      const input = linearSchemas[name].parse(raw);
      const issue = find(input);
      const target = input.commentId
        ? issue.comments.find((item) => item.id === input.commentId)
        : issue;
      if (!target)
        throw new OperationError(
          "The target comment does not match.",
          "invalid-input",
        );
      if (input.action === "add") {
        if (
          !target.reactions.some(
            (item) => item.emoji === input.emoji && item.userId === userId,
          )
        )
          target.reactions.push({
            id: randomUUID(),
            emoji: input.emoji,
            userId,
          });
      } else {
        const current = target.reactions.find(
          (item) => item.id === input.reactionId,
        );
        if (!current || current.userId !== userId)
          throw new OperationError(
            "You can only remove your own matching reaction.",
            "forbidden",
          );
        target.reactions = target.reactions.filter(
          (item) => item.id !== current.id,
        );
      }
      return {
        ...touch(issue),
        ...(input.commentId
          ? { changedComment: structuredClone(target as LinearComment) }
          : {}),
      };
    }
    if (name === "linear_relation") {
      const input = linearSchemas[name].parse(raw);
      const issue = find(input);
      if (input.action === "add") {
        const other = issues.get(input.relatedIssueId ?? "");
        if (!other || other.issueId === issue.issueId)
          throw new OperationError(
            "The related issue does not match.",
            "invalid-input",
          );
        const relation = {
          id: randomUUID(),
          type: input.kind === "related" ? "related" : "blocks",
          issueId: input.kind === "blocked-by" ? other.issueId : issue.issueId,
          relatedIssueId:
            input.kind === "blocked-by" ? issue.issueId : other.issueId,
          identifier: other.identifier,
          title: other.title,
        };
        issue.relations.push(relation);
        other.relations.push({
          ...relation,
          identifier: issue.identifier,
          title: issue.title,
        });
      } else
        for (const item of issues.values())
          item.relations = item.relations.filter(
            (value) => value.id !== input.relationId,
          );
      return touch(issue);
    }
    if (name === "linear_upload") {
      const input = linearSchemas[name].parse(raw);
      const issue = find(input);
      decodeLinearUpload(input.base64);
      issue.attachments.push({
        id: randomUUID(),
        title: input.filename,
        url: `https://linear.app/fixture/files/${encodeURIComponent(input.filename)}`,
      });
      return touch(issue);
    }
    if (name === "linear_bulk") {
      const input = linearSchemas[name].parse(raw);
      scope(input);
      const results = [];
      for (const issueId of [...new Set(input.issueIds)]) {
        try {
          const issue = structuredClone(find({ ...input, issueId }));
          if (input.patch) patchIssue(issue, input.patch);
          labels(issue, input.addLabels ?? [], input.removeLabels ?? []);
          issues.set(issueId, issue);
          results.push({ issueId, success: true, issue: touch(issue) });
        } catch (error) {
          results.push({
            issueId,
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "The fixture bulk change failed.",
          });
        }
      }
      return { results };
    }
    throw new OperationError("Unsupported fixture operation.", "unsupported");
  }
  return {
    async call(name, raw) {
      const parsed = linearSchemas[name].parse(raw);
      return "requestId" in parsed
        ? once(z.string().parse(parsed.requestId), [name, parsed], () =>
            execute(name, parsed),
          )
        : execute(name, parsed);
    },
  };
}
