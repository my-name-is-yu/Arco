import { LinearServiceError, linearFailure } from "./errors";
import { trackWrite } from "../write-guard";
import {
  LinearClient,
  PaginationOrderBy,
  type Comment,
  type Issue,
  type IssueLabel,
  type Reaction,
  type Team,
  type Template,
} from "@linear/sdk";
import { z } from "zod";
import {
  linearPatchSchema,
  linearSchemas,
  type LinearComment,
  type LinearCommentPage,
  type LinearIssue,
  type LinearLabel,
  type LinearMetadata,
  type LinearRef,
  type LinearSavedReceipt,
  type LinearScope,
  type LinearTemplate,
  type LinearToolName,
} from "../../shared/linear";
import { type LinearAuth } from "./auth";
export type Args<N extends LinearToolName> = z.output<
  (typeof linearSchemas)[N]
>;

export type IssueUpdateInput = Parameters<LinearClient["updateIssue"]>[1];

export type IssueFilter = NonNullable<
  NonNullable<Parameters<LinearClient["issues"]>[0]>["filter"]
>;

export type Connection<T> = {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  fetchNext(): Promise<unknown>;
};

export async function all<T>(value: PromiseLike<Connection<T>>): Promise<T[]> {
  const connection = await value;
  while (connection.pageInfo.hasNextPage) {
    const before = connection.pageInfo.endCursor;
    await connection.fetchNext();
    if (connection.pageInfo.endCursor === before)
      throw new LinearServiceError(
        "Linear pagination did not advance. Refresh and try again.",
        "invalid-response",
      );
  }
  return connection.nodes;
}

export const named = (
  value: { id: string; name: string } | null | undefined,
) => (value ? { id: value.id, name: value.name } : null);

export const label = (value: IssueLabel): LinearLabel => ({
  id: value.id,
  name: value.name,
  color: value.color,
  description: value.description ?? null,
  teamId: value.teamId ?? null,
  parentId: value.parentId ?? null,
  isGroup: value.isGroup,
});

export const reaction = (value: Reaction) => ({
  id: value.id,
  emoji: value.emoji,
  userId: value.userId ?? "",
});

export function assertSuccess(value: { success: boolean }) {
  if (value?.success === false)
    throw new LinearServiceError(
      "Linear did not accept this change. It has not been marked as saved.",
      "invalid-input",
    );
  if (value?.success !== true)
    throw new LinearServiceError(
      "Linear did not confirm whether this change was saved. Check Linear and refresh before retrying.",
      "uncertain",
    );
}

export function linearMutation<T extends { success: boolean }>(
  write: () => PromiseLike<T>,
): Promise<T> {
  return trackWrite(
    async () => {
      try {
        const result = await write();
        assertSuccess(result);
        return result;
      } catch (error) {
        throw linearFailure(error, { write: true });
      }
    },
    (error) => linearFailure(error, { write: true }).code !== "uncertain",
  );
}

export function estimateValues(
  team: Pick<
    Team,
    | "issueEstimationType"
    | "issueEstimationAllowZero"
    | "issueEstimationExtended"
  >,
) {
  const scales: Record<string, number[]> = {
    exponential: [1, 2, 4, 8, 16, 32, 64],
    fibonacci: [1, 2, 3, 5, 8, 13, 21],
    linear: [1, 2, 3, 4, 5, 6, 7],
    tShirt: [1, 2, 3, 5, 8, 13, 21],
  };
  const values =
    scales[team.issueEstimationType]?.slice(
      0,
      team.issueEstimationExtended ? 7 : 5,
    ) ?? [];
  return values.length && team.issueEstimationAllowZero
    ? [0, ...values]
    : values;
}

export function describeTemplate(
  value: Pick<
    Template,
    "id" | "name" | "description" | "type" | "templateData" | "content"
  >,
): LinearTemplate {
  const allowed = new Set([
    "title",
    "description",
    "stateId",
    "assigneeId",
    "priority",
    "estimate",
    "dueDate",
    "labelIds",
    "projectId",
    "projectMilestoneId",
    "cycleId",
  ]);
  const unknown = Object.keys(value.templateData).filter(
    (key) => !allowed.has(key),
  );
  const { description, ...attributes } = value.templateData;
  const parsedDefaults = linearPatchSchema
    .omit({ parentId: true })
    .extend({ labelIds: z.array(z.string().min(1)).optional() })
    .safeParse({
      ...attributes,
      ...(value.content != null
        ? { body: value.content }
        : typeof description === "string"
          ? { body: description }
          : {}),
    });
  const supported =
    value.type === "issue" &&
    unknown.length === 0 &&
    parsedDefaults.success &&
    !/\{\{|\[\[[^\]]+\]\]|<input\b|<select\b/i.test(value.content ?? "");
  return {
    id: value.id,
    name: value.name,
    description: value.description ?? null,
    supported,
    ...(supported && parsedDefaults.success
      ? { defaults: parsedDefaults.data }
      : {}),
    ...(!supported
      ? {
          reason:
            "This template may include a form, child issues, or unsupported properties. Create it in Linear.",
        }
      : {}),
  };
}
export function createLinearOperation(options: {
  auth: LinearAuth;
  client: (accessToken: string) => LinearClient;
  fetch: typeof fetch;
}) {
  const auth = options.auth;
  const makeClient = options.client;
  const request = options.fetch;
  const contexts = new Map<string, ReturnType<typeof loadContext>>();
  const metadataValues = new Map<string, Promise<LinearMetadata>>();
  const scopeKey = (scope: LinearScope) =>
    JSON.stringify([scope.connectionId, scope.workspaceId, scope.teamId]);
  return {
    auth,
    makeClient,
    request,
    context,
    checkedIssue,
    metadata,
    summary,
    commentData,
    commentsPage,
    detail,
    refreshAfterWrite,
    templates,
  };
  function context(scope: LinearScope) {
    const key = scopeKey(scope);
    let pending = contexts.get(key);
    if (!pending) {
      pending = loadContext(scope);
      contexts.set(key, pending);
      void pending.catch(() => contexts.delete(key));
    }
    return pending;
  }
  function metadata(
    scope: LinearScope,
    fields: readonly (keyof LinearMetadata)[] = [
      "states",
      "members",
      "labels",
      "projects",
      "cycles",
      "milestones",
      "estimateValues",
    ],
  ) {
    const key = JSON.stringify([scopeKey(scope), [...fields].sort()]);
    let pending = metadataValues.get(key);
    if (!pending) {
      pending = loadMetadata(scope, fields);
      metadataValues.set(key, pending);
      void pending.catch(() => metadataValues.delete(key));
    }
    return pending;
  }

  async function loadContext(scope: LinearScope) {
    const client = makeClient(await auth.accessToken(scope.connectionId));
    const organization = await client.organization;
    if (organization.id !== scope.workspaceId)
      throw new LinearServiceError(
        "The selected Linear workspace does not match this connection.",
      );
    const team = await client.team(scope.teamId);
    if ((await team.organization).id !== scope.workspaceId)
      throw new LinearServiceError(
        "The selected team does not belong to this workspace.",
      );
    return { client, organization, team };
  }

  async function checkedIssue(
    client: LinearClient,
    ref: LinearRef,
  ): Promise<Issue> {
    const issue = await client.issue(ref.issueId);
    if (issue.teamId !== ref.teamId)
      throw new LinearServiceError(
        "The issue does not belong to the selected team. Move issues in Linear.",
      );
    return issue;
  }

  async function loadMetadata(
    scope: LinearScope,
    fields: readonly (keyof LinearMetadata)[],
  ): Promise<LinearMetadata> {
    const { organization, team } = await context(scope);
    const wants = (field: keyof LinearMetadata) => fields.includes(field);
    const chain = [team];
    while (
      (wants("states") || wants("labels") || wants("estimateValues")) &&
      chain.at(-1)?.parent
    ) {
      const parent = await chain.at(-1)!.parent;
      if (!parent || chain.some((item) => item.id === parent.id)) break;
      chain.push(parent);
    }
    const stateTeam = chain.find(
      (item, index) =>
        index === chain.length - 1 || !item.inheritWorkflowStatuses,
    )!;
    const estimateTeam = chain.find(
      (item, index) =>
        index === chain.length - 1 || !item.inheritIssueEstimation,
    )!;
    const [states, members, workspaceLabels, labelsByTeam, projects, cycles] =
      await Promise.all([
        wants("states") ? all(stateTeam.states({ first: 100 })) : [],
        wants("members") ? all(team.members({ first: 100 })) : [],
        wants("labels") ? all(organization.labels({ first: 100 })) : [],
        wants("labels")
          ? Promise.all(chain.map((item) => all(item.labels({ first: 100 }))))
          : [],
        wants("projects") || wants("milestones")
          ? all(team.projects({ first: 100 }))
          : [],
        wants("cycles") ? all(team.cycles({ first: 100 })) : [],
      ]);
    const milestones = await Promise.all(
      (wants("milestones") ? projects : []).map(async (project) =>
        (await all(project.projectMilestones({ first: 100 }))).map(
          (milestone) => ({
            id: milestone.id,
            name: milestone.name,
            projectId: project.id,
          }),
        ),
      ),
    );
    return {
      states: states.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        color: item.color,
      })),
      members: members.map((item) => ({ id: item.id, name: item.name })),
      labels: [
        ...new Map(
          [...workspaceLabels, ...labelsByTeam.flat()].map((item) => [
            item.id,
            label(item),
          ]),
        ).values(),
      ],
      projects: projects.map((item) => ({ id: item.id, name: item.name })),
      cycles: cycles.map((item) => ({
        id: item.id,
        name: item.name ?? `Cycle ${item.number}`,
      })),
      milestones: milestones.flat(),
      estimateValues: wants("estimateValues")
        ? estimateValues(estimateTeam)
        : [],
    };
  }

  async function summary(
    scope: LinearScope,
    issue: Issue,
  ): Promise<
    Omit<
      LinearIssue,
      | "parent"
      | "children"
      | "comments"
      | "commentsHasMore"
      | "commentsCursor"
      | "changedComment"
      | "deletedCommentId"
      | "attachments"
      | "relations"
      | "reactions"
    >
  > {
    const creatorRead = issue.creator;
    const [state, creator, assignee, project, milestone, cycle, labels] =
      await Promise.all([
        issue.state,
        creatorRead,
        issue.assigneeId === issue.creatorId ? creatorRead : issue.assignee,
        issue.project,
        issue.projectMilestone,
        issue.cycle,
        issue.labelIds.length ? all(issue.labels({ first: 100 })) : [],
      ]);
    if (!state)
      throw new LinearServiceError(
        "The Linear workflow state could not be loaded.",
        "invalid-response",
      );
    if (issue.labelIds.some((id) => !labels.some((value) => value.id === id)))
      throw new LinearServiceError(
        "The issue label definitions could not be loaded completely. Refresh and try again.",
        "invalid-response",
      );
    return {
      connectionId: scope.connectionId,
      workspaceId: scope.workspaceId,
      teamId: scope.teamId,
      issueId: issue.id,
      source: "linear",
      identifier: issue.identifier,
      title: issue.title,
      body: issue.description ?? "",
      url: issue.url,
      updatedAt: issue.updatedAt.toISOString(),
      author: creator?.name ?? "Deleted user",
      state: {
        id: state.id,
        name: state.name,
        type: state.type,
        color: state.color,
      },
      assignee: named(assignee),
      labels: labels.map(label),
      priority: issue.priority,
      estimate: issue.estimate ?? null,
      dueDate: issue.dueDate ?? null,
      project: named(project),
      projectMilestone: named(milestone),
      cycle: cycle ? { id: cycle.id, name: cycle.name ?? "Cycle" } : null,
    };
  }

  async function commentData(item: Comment): Promise<LinearComment> {
    const author = await item.user;
    return {
      id: item.id,
      body: item.body,
      author: author?.name ?? "Deleted user",
      authorId: item.userId ?? "",
      parentId: item.parentId ?? null,
      updatedAt: item.updatedAt.toISOString(),
      url: item.url,
      reactions: item.reactions.map(reaction),
    };
  }

  async function commentsPage(
    issue: Issue,
    cursor?: string,
  ): Promise<LinearCommentPage> {
    const connection = await issue.comments({
      first: 30,
      orderBy: PaginationOrderBy.CreatedAt,
      ...(cursor ? { after: cursor } : {}),
    });
    const next = connection.pageInfo.endCursor ?? null;
    if (connection.pageInfo.hasNextPage && (!next || next === cursor))
      throw new LinearServiceError(
        "Linear comment pagination did not advance. Refresh and try again.",
        "invalid-response",
      );
    return {
      comments: await Promise.all(connection.nodes.map(commentData)),
      hasMore: connection.pageInfo.hasNextPage,
      cursor: next,
    };
  }

  async function detail(scope: LinearRef): Promise<LinearIssue> {
    const { client } = await context(scope);
    const issue = await checkedIssue(client, scope);
    const [base, parent, children, comments, attachments, outward, inward] =
      await Promise.all([
        summary(scope, issue),
        issue.parent,
        all(issue.children({ first: 100 })),
        commentsPage(issue),
        all(issue.attachments({ first: 100 })),
        all(issue.relations({ first: 100 })),
        all(issue.inverseRelations({ first: 100 })),
      ]);
    const relations = await Promise.all(
      [
        ...new Map(
          [...outward, ...inward].map((item) => [item.id, item]),
        ).values(),
      ].map(async (item) => {
        const { issueId, relatedIssueId } = item;
        if (
          typeof item.id !== "string" ||
          !item.id ||
          typeof issueId !== "string" ||
          !issueId ||
          typeof relatedIssueId !== "string" ||
          !relatedIssueId ||
          (issueId !== issue.id && relatedIssueId !== issue.id)
        )
          throw new LinearServiceError(
            "Linear returned an incomplete or mismatched issue relation.",
            "invalid-response",
          );
        const other =
          issueId === issue.id ? await item.relatedIssue : await item.issue;
        const otherId = issueId === issue.id ? relatedIssueId : issueId;
        if (
          !other ||
          other.id !== otherId ||
          typeof other.identifier !== "string" ||
          !other.identifier ||
          typeof other.title !== "string" ||
          !other.title
        )
          throw new LinearServiceError(
            "Linear returned an incomplete or mismatched related issue.",
            "invalid-response",
          );
        return {
          id: item.id,
          type:
            item.type === "blocks" && item.relatedIssueId === issue.id
              ? "blocked-by"
              : item.type,
          issueId,
          relatedIssueId,
          identifier: other.identifier,
          title: other.title,
        };
      }),
    );
    return {
      ...base,
      parent: parent
        ? { id: parent.id, identifier: parent.identifier, title: parent.title }
        : null,
      children: children.map((item) => ({
        id: item.id,
        identifier: item.identifier,
        title: item.title,
      })),
      comments: comments.comments,
      commentsHasMore: comments.hasMore,
      commentsCursor: comments.cursor,
      attachments: attachments.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
      })),
      relations,
      reactions: issue.reactions.map(reaction),
    };
  }

  async function refreshAfterWrite(
    scope: LinearRef,
    acknowledgement?: string,
    receipt?: Pick<LinearSavedReceipt, "operation" | "commentId">,
    commentChange?: { commentId?: string; deletedCommentId?: string },
  ): Promise<LinearIssue | LinearSavedReceipt> {
    try {
      const refreshed = await detail(scope);
      if (commentChange?.commentId) {
        const { client } = await context(scope);
        const comment = await client.comment({ id: commentChange.commentId });
        if ((await comment.issue)?.id !== scope.issueId)
          throw new LinearServiceError(
            "The comment does not belong to the selected issue.",
          );
        refreshed.changedComment = await commentData(comment);
      }
      if (commentChange?.deletedCommentId)
        refreshed.deletedCommentId = commentChange.deletedCommentId;
      return refreshed;
    } catch {
      const message = `${acknowledgement ?? "The change was saved in Linear."} The latest issue details could not be loaded. Refresh before making another change.`;
      if (receipt)
        return {
          connectionId: scope.connectionId,
          workspaceId: scope.workspaceId,
          teamId: scope.teamId,
          issueId: scope.issueId,
          kind: "linear_saved_receipt",
          saved: true,
          ...receipt,
          message,
        };
      throw new LinearServiceError(
        `${message} Your draft was kept.`,
        "uncertain",
      );
    }
  }

  async function templates(scope: LinearScope) {
    const { organization, team } = await context(scope);
    const values = [
      ...(await all(organization.templates({ first: 100 }))).filter(
        (template) => !template.teamId,
      ),
      ...(await all(team.templates({ first: 100 }))),
    ];
    return {
      templates: [
        ...new Map(
          values.map((value) => [value.id, describeTemplate(value)]),
        ).values(),
      ],
    };
  }
}
export type LinearOperation = ReturnType<typeof createLinearOperation>;
export type LinearHandlers = {
  [N in LinearToolName]: (input: Args<N>) => Promise<object>;
};
