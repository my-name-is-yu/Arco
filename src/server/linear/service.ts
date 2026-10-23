import {
  LinearClient,
  PaginationOrderBy,
  IssueRelationType,
  type Issue,
  type IssueSearchResult,
  type IssueLabel,
  type Reaction,
  type Team,
  type Template,
} from "@linear/sdk";
import { z } from "zod";
import {
  linearSchemas,
  linearPatchSchema,
  type LinearService,
  type LinearToolName,
  type LinearScope,
  type LinearRef,
  type LinearIssue,
  type LinearIssueSummary,
  type LinearMetadata,
  type LinearLabel,
  type LinearTemplate,
  type LinearSavedReceipt,
} from "../../shared/linear";
import { createWriteGuard } from "../github";
import { createLinearAuth, type LinearAuth } from "./auth";
import { readIssueImage } from "../images";
import { decodeLinearUpload } from "./upload";
import { linearIssueUrl } from "../../shared/issue-url";

type Args<N extends LinearToolName> = z.output<(typeof linearSchemas)[N]>;
type IssueUpdateInput = Parameters<LinearClient["updateIssue"]>[1];
type IssueFilter = NonNullable<
  NonNullable<Parameters<LinearClient["issues"]>[0]>["filter"]
>;
type Connection<T> = {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  fetchNext(): Promise<unknown>;
};
async function all<T>(value: PromiseLike<Connection<T>>): Promise<T[]> {
  const connection = await value;
  while (connection.pageInfo.hasNextPage) {
    const before = connection.pageInfo.endCursor;
    await connection.fetchNext();
    if (connection.pageInfo.endCursor === before)
      throw new Error(
        "Linear pagination did not advance. Refresh and try again.",
      );
  }
  return connection.nodes;
}
const named = (value: { id: string; name: string } | null | undefined) =>
  value ? { id: value.id, name: value.name } : null;
const label = (value: IssueLabel): LinearLabel => ({
  id: value.id,
  name: value.name,
  color: value.color,
  description: value.description ?? null,
  teamId: value.teamId ?? null,
  parentId: value.parentId ?? null,
  isGroup: value.isGroup,
});
const reaction = (value: Reaction) => ({
  id: value.id,
  emoji: value.emoji,
  userId: value.userId ?? "",
});
function assertSuccess(value: { success: boolean }) {
  if (!value.success)
    throw new Error(
      "Linear did not accept this change. It has not been marked as saved.",
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
export function createLinearService(
  options: {
    auth?: LinearAuth;
    client?: (accessToken: string) => LinearClient;
    fetch?: typeof fetch;
  } = {},
): LinearService {
  const auth = options.auth ?? createLinearAuth();
  const makeClient =
    options.client ?? ((accessToken) => new LinearClient({ accessToken }));
  const request = options.fetch ?? fetch;
  const once = createWriteGuard<object>();
  async function context(scope: LinearScope) {
    const client = makeClient(await auth.accessToken(scope.connectionId));
    const organization = await client.organization;
    if (organization.id !== scope.workspaceId)
      throw new Error(
        "The selected Linear workspace does not match this connection.",
      );
    const team = await client.team(scope.teamId);
    if ((await team.organization).id !== scope.workspaceId)
      throw new Error("The selected team does not belong to this workspace.");
    return { client, organization, team };
  }
  async function checkedIssue(
    client: LinearClient,
    ref: LinearRef,
  ): Promise<Issue> {
    const issue = await client.issue(ref.issueId);
    if (issue.teamId !== ref.teamId)
      throw new Error(
        "The issue does not belong to the selected team. Move issues in Linear.",
      );
    return issue;
  }
  async function metadata(scope: LinearScope): Promise<LinearMetadata> {
    const { organization, team } = await context(scope);
    const chain = [team];
    while (chain.at(-1)?.parent) {
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
        all(stateTeam.states({ first: 100 })),
        all(team.members({ first: 100 })),
        all(organization.labels({ first: 100 })),
        Promise.all(chain.map((item) => all(item.labels({ first: 100 })))),
        all(team.projects({ first: 100 })),
        all(team.cycles({ first: 100 })),
      ]);
    const milestones = await Promise.all(
      projects.map(async (project) =>
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
      estimateValues: estimateValues(estimateTeam),
    };
  }
  async function summary(
    scope: LinearScope,
    issue: Issue | IssueSearchResult,
    meta: LinearMetadata,
  ): Promise<LinearIssueSummary> {
    const state =
      meta.states.find((value) => value.id === issue.stateId) ??
      (await issue.state);
    if (!state)
      throw new Error("The Linear workflow state could not be loaded.");
    const creator =
      meta.members.find((value) => value.id === issue.creatorId) ??
      (await issue.creator);
    const assignee =
      meta.members.find((value) => value.id === issue.assigneeId) ??
      (await issue.assignee);
    const project =
      meta.projects.find((value) => value.id === issue.projectId) ??
      (await issue.project);
    const milestone =
      meta.milestones.find((value) => value.id === issue.projectMilestoneId) ??
      (await issue.projectMilestone);
    const cycle =
      meta.cycles.find((value) => value.id === issue.cycleId) ??
      (await issue.cycle);
    const labels = issue.labelIds.map((id) =>
      meta.labels.find((value) => value.id === id),
    );
    if (labels.some((value) => !value))
      throw new Error(
        "The issue label definitions could not be loaded completely. Refresh and try again.",
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
      labels: labels.filter((value): value is LinearLabel => Boolean(value)),
      priority: issue.priority,
      estimate: issue.estimate ?? null,
      dueDate: issue.dueDate ?? null,
      project: named(project),
      projectMilestone: named(milestone),
      cycle: cycle ? { id: cycle.id, name: cycle.name ?? "Cycle" } : null,
    };
  }
  async function detail(scope: LinearRef): Promise<LinearIssue> {
    const { client } = await context(scope);
    const issue = await checkedIssue(client, scope);
    const meta = await metadata(scope);
    const [base, parent, children, comments, attachments, outward, inward] =
      await Promise.all([
        summary(scope, issue, meta),
        issue.parent,
        all(issue.children({ first: 100 })),
        all(issue.comments({ first: 100 })),
        all(issue.attachments({ first: 100 })),
        all(issue.relations({ first: 100 })),
        all(issue.inverseRelations({ first: 100 })),
      ]);
    const commentData = await Promise.all(
      comments.map(async (item) => {
        const [author, parent] = await Promise.all([item.user, item.parent]);
        return {
          id: item.id,
          body: item.body,
          author: author?.name ?? "Deleted user",
          authorId: item.userId ?? "",
          parentId: parent?.id ?? null,
          updatedAt: item.updatedAt.toISOString(),
          url: item.url,
          reactions: item.reactions.map(reaction),
        };
      }),
    );
    const relations = await Promise.all(
      [
        ...new Map(
          [...outward, ...inward].map((item) => [item.id, item]),
        ).values(),
      ].map(async (item) => {
        const other =
          item.issueId === issue.id
            ? await item.relatedIssue
            : await item.issue;
        return {
          id: item.id,
          type:
            item.type === "blocks" && item.relatedIssueId === issue.id
              ? "blocked-by"
              : item.type,
          issueId: item.issueId ?? "",
          relatedIssueId: item.relatedIssueId ?? "",
          identifier: other?.identifier ?? "",
          title: other?.title ?? "",
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
      comments: commentData,
      commentsHasMore: false,
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
  ): Promise<LinearIssue | LinearSavedReceipt> {
    try {
      return await detail(scope);
    } catch {
      const message = `${acknowledgement ?? `The change was saved to Linear issue ${scope.issueId}.`} Its details could not be refreshed. Refresh before another change.`;
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
      throw new Error(`${message} Your draft was kept.`);
    }
  }
  async function validatePatch(
    scope: LinearRef,
    current: Issue,
    patch: Args<"linear_update_issue">["patch"],
  ): Promise<IssueUpdateInput> {
    const meta = await metadata(scope);
    const includes = (
      values: { id: string }[],
      id: string | null | undefined,
      field: string,
    ) => {
      if (id != null && !values.some((value) => value.id === id))
        throw new Error(
          `${field} does not match an existing value in the selected team.`,
        );
    };
    includes(meta.states, patch.stateId, "workflow state");
    if (
      meta.states.some(
        (state) => state.id === patch.stateId && state.type === "duplicate",
      )
    )
      throw new Error(
        "Merge duplicate issues in Linear. Changing the state alone cannot perform a merge.",
      );
    includes(meta.members, patch.assigneeId, "Assignee");
    includes(meta.projects, patch.projectId, "Project");
    includes(meta.cycles, patch.cycleId, "cycle");
    if (patch.estimate != null && !meta.estimateValues.includes(patch.estimate))
      throw new Error("This value is not in the team's estimate scale.");
    if (
      patch.projectMilestoneId != null &&
      !meta.milestones.some(
        (value) =>
          value.id === patch.projectMilestoneId &&
          value.projectId ===
            (patch.projectId === undefined
              ? current.projectId
              : patch.projectId),
      )
    )
      throw new Error(
        "The project milestone does not match the target project.",
      );
    if (patch.parentId) {
      const { client } = await context(scope);
      const parent = await client.issue(patch.parentId);
      if (
        parent.id === current.id ||
        (await (await parent.team)?.organization)?.id !== scope.workspaceId
      )
        throw new Error(
          "The parent issue is in another workspace or refers to this issue itself.",
        );
    }
    const { body, ...attributes } = patch;
    return {
      ...attributes,
      ...(body === undefined ? {} : { description: body }),
    };
  }
  async function changeLabels(input: Args<"linear_change_labels">) {
    const { client } = await context(input);
    const current = await checkedIssue(client, input);
    const meta = await metadata(input);
    const additions = input.add.map((id) =>
      meta.labels.find((value) => value.id === id),
    );
    if (
      additions.some((value) => !value || value.isGroup) ||
      input.remove.some(
        (id) => !meta.labels.some((value) => value.id === id),
      ) ||
      input.add.some((id) => input.remove.includes(id))
    )
      throw new Error(
        "Choose existing team or workspace labels without overlapping additions and removals. Label groups cannot be applied directly.",
      );
    for (const addition of additions)
      if (addition?.parentId) {
        const parent = await client.issueLabel(addition.parentId);
        if (parent.groupType !== "multiSelect") {
          const siblings = meta.labels.filter(
            (value) =>
              value.parentId === addition.parentId && value.id !== addition.id,
          );
          if (
            siblings.some(
              (value) =>
                input.add.includes(value.id) ||
                (current.labelIds.includes(value.id) &&
                  !input.remove.includes(value.id)),
            )
          )
            throw new Error(
              "To replace a label in a single-select group, explicitly choose the label to remove.",
            );
        }
      }
    assertSuccess(
      await client.updateIssue(current.id, {
        addedLabelIds: input.add,
        removedLabelIds: input.remove,
      }),
    );
    return refreshAfterWrite({ ...input, issueId: current.id });
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
  async function execute(name: LinearToolName, raw: unknown): Promise<object> {
    if (name === "linear_auth_status") {
      const input = linearSchemas[name].parse(raw);
      return {
        ...auth.status(input.connectionId),
        connected: await auth.hasConnection(input.connectionId),
      };
    }
    if (name === "linear_auth_begin") {
      const input = linearSchemas[name].parse(raw);
      return auth.begin(input.connectionId, input.clientId, input.redirectUri);
    }
    if (name === "linear_auth_disconnect") {
      const input = linearSchemas[name].parse(raw);
      return auth.disconnect(input.connectionId, input.revoke);
    }
    if (name === "linear_connection" || name === "linear_scopes") {
      const input = linearSchemas[name].parse(raw);
      if (!(await auth.hasConnection(input.connectionId)))
        return {
          connectionId: input.connectionId,
          connected: false,
          mode: "linear",
          account: null,
          userId: null,
          workspace: null,
          message: "Authorize Arco with Linear to connect.",
        };
      const client = makeClient(await auth.accessToken(input.connectionId));
      const [viewer, organization] = await Promise.all([
        client.viewer,
        client.organization,
      ]);
      if (name === "linear_connection")
        return {
          connectionId: input.connectionId,
          connected: true,
          mode: "linear",
          account: viewer.name,
          userId: viewer.id,
          workspace: named(organization),
          message: "Connected to Linear with your account permissions.",
        };
      return {
        workspace: named(organization),
        teams: (await all(client.teams({ first: 100 }))).map((team) => ({
          id: team.id,
          name: team.name,
          key: team.key,
        })),
      };
    }
    if (name === "linear_metadata")
      return metadata(linearSchemas[name].parse(raw));
    if (name === "linear_resolve_issue") {
      const input = linearSchemas[name].parse(raw);
      const target = linearIssueUrl(input.url);
      const client = makeClient(await auth.accessToken(input.connectionId));
      const organization = await client.organization;
      if (organization.urlKey.toLowerCase() !== target.workspace)
        throw new Error(
          "This issue URL belongs to a different Linear workspace. Use its authorized connection.",
        );
      const issue = await client.issue(target.identifier);
      const canonical = linearIssueUrl(issue.url);
      if (
        canonical.workspace !== target.workspace ||
        canonical.identifier !== target.identifier ||
        issue.identifier.toUpperCase() !== target.identifier
      )
        throw new Error(
          "Linear returned a different issue than the pasted URL.",
        );
      const team = await issue.team;
      if (
        !team ||
        team.id !== issue.teamId ||
        (await team.organization).id !== organization.id
      )
        throw new Error(
          "The resolved issue team does not belong to this Linear workspace.",
        );
      return {
        connectionId: input.connectionId,
        workspaceId: organization.id,
        teamId: team.id,
        issueId: issue.id,
      };
    }
    if (name === "linear_get_issue")
      return detail(linearSchemas[name].parse(raw));
    if (name === "linear_read_image") {
      const input = linearSchemas[name].parse(raw);
      const issue = await detail(input);
      const markdown = input.commentId
        ? issue.comments.find((comment) => comment.id === input.commentId)?.body
        : issue.body;
      if (markdown === undefined)
        throw new Error("The image comment does not belong to this issue.");
      return readIssueImage({
        url: input.url,
        markdown,
        authorization: {
          hostname: "uploads.linear.app",
          value: `Bearer ${await auth.accessToken(input.connectionId)}`,
        },
      });
    }
    if (name === "linear_templates")
      return templates(linearSchemas[name].parse(raw));
    if (name === "linear_list_issues") {
      const input = linearSchemas[name].parse(raw);
      const { client } = await context(input);
      const meta = await metadata(input);
      const filter: IssueFilter = {
        team: { id: { eq: input.teamId } },
        ...(input.stateId ? { state: { id: { eq: input.stateId } } } : {}),
        ...(input.assigneeId
          ? { assignee: { id: { eq: input.assigneeId } } }
          : {}),
        ...(input.labelId
          ? { labels: { some: { id: { eq: input.labelId } } } }
          : {}),
        ...(input.projectId
          ? { project: { id: { eq: input.projectId } } }
          : {}),
      };
      const parameters = {
        filter,
        first: 30,
        after: input.cursor,
        orderBy:
          input.order === "createdAt"
            ? PaginationOrderBy.CreatedAt
            : PaginationOrderBy.UpdatedAt,
      };
      const page = input.query.trim()
        ? await client.searchIssues(input.query, {
            ...parameters,
            teamId: input.teamId,
            includeComments: true,
          })
        : await client.issues(parameters);
      return {
        issues: await Promise.all(
          page.nodes.map((issue) => summary(input, issue, meta)),
        ),
        hasMore: page.pageInfo.hasNextPage,
        cursor: page.pageInfo.endCursor ?? null,
      };
    }
    if (name === "linear_create_issue") {
      const input = linearSchemas[name].parse(raw);
      const { client } = await context(input);
      if (
        input.templateId &&
        !(await templates(input)).templates.some(
          (value) => value.id === input.templateId && value.supported,
        )
      )
        throw new Error(
          "Create an issue from this template in Linear so every field is preserved.",
        );
      if (input.parentId) {
        const parent = await client.issue(input.parentId);
        if ((await (await parent.team)?.organization)?.id !== input.workspaceId)
          throw new Error("The parent issue belongs to another workspace.");
      }
      const created = await client.createIssue({
        teamId: input.teamId,
        title: input.title,
        ...(input.body !== undefined
          ? { description: input.body }
          : input.templateId
            ? {}
            : { description: "" }),
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(input.templateId ? { templateId: input.templateId } : {}),
      });
      assertSuccess(created);
      if (!created.issueId)
        throw new Error(
          "The created Linear issue ID could not be loaded. Check Linear before creating another issue.",
        );
      return refreshAfterWrite(
        { ...input, issueId: created.issueId },
        `Linear issue ${created.issueId} was created. Do not create it again.`,
        { operation: "create_issue" },
      );
    }
    if (name === "linear_update_issue") {
      const input = linearSchemas[name].parse(raw);
      const { client } = await context(input);
      const current = await checkedIssue(client, input);
      if (current.updatedAt.toISOString() !== input.expectedUpdatedAt)
        throw new Error(
          "This Linear issue changed elsewhere. Keep your draft and refresh.",
        );
      assertSuccess(
        await client.updateIssue(
          current.id,
          await validatePatch(input, current, input.patch),
        ),
      );
      return refreshAfterWrite({ ...input, issueId: current.id });
    }
    if (name === "linear_change_labels")
      return changeLabels(linearSchemas[name].parse(raw));
    if (name === "linear_label_definition") {
      const input = linearSchemas[name].parse(raw);
      const { client } = await context(input);
      if (input.action === "create") {
        if (!input.name) throw new Error("Enter a label name.");
        assertSuccess(
          await client.createIssueLabel({
            name: input.name,
            color: input.color,
            description: input.description,
            ...(input.scope === "team" ? { teamId: input.teamId } : {}),
          }),
        );
      } else {
        if (!input.labelId) throw new Error("Choose a target label.");
        const current = await client.issueLabel(input.labelId);
        if (
          (current.teamId ?? null) !==
          (input.scope === "team" ? input.teamId : null)
        )
          throw new Error(
            "The original label scope does not match. Move label scopes in Linear.",
          );
        if (current.isGroup) throw new Error("Manage label groups in Linear.");
        assertSuccess(
          input.action === "delete"
            ? await client.deleteIssueLabel(current.id)
            : await client.updateIssueLabel(current.id, {
                name: input.name,
                color: input.color,
                description: input.description,
              }),
        );
      }
      return metadata(input);
    }
    if (name === "linear_comment") {
      const input = linearSchemas[name].parse(raw);
      const { client } = await context(input);
      const issue = await checkedIssue(client, input);
      if (input.action === "create") {
        if (!input.body) throw new Error("Enter a comment body.");
        if (
          input.parentId &&
          (await (await client.comment({ id: input.parentId })).issue)?.id !==
            issue.id
        )
          throw new Error("The reply target does not belong to this issue.");
        const created = await client.createComment({
          issueId: issue.id,
          body: input.body,
          parentId: input.parentId,
        });
        assertSuccess(created);
        return refreshAfterWrite(
          input,
          `Comment ${created.commentId ?? "(source ID unavailable)"} was posted to Linear issue ${issue.id}. Do not post it again.`,
          {
            operation: "create_comment",
            ...(created.commentId ? { commentId: created.commentId } : {}),
          },
        );
      } else {
        if (!input.commentId) throw new Error("Choose a target comment.");
        const comment = await client.comment({ id: input.commentId });
        if ((await comment.issue)?.id !== issue.id)
          throw new Error("The comment does not belong to the selected issue.");
        if (
          input.expectedUpdatedAt &&
          comment.updatedAt.toISOString() !== input.expectedUpdatedAt
        )
          throw new Error(
            "This Linear comment changed elsewhere. Keep your draft and refresh.",
          );
        if (input.action === "update" && !input.body)
          throw new Error("Enter a comment body.");
        assertSuccess(
          input.action === "delete"
            ? await client.deleteComment(comment.id)
            : await client.updateComment(comment.id, { body: input.body }),
        );
      }
      return refreshAfterWrite(input);
    }
    if (name === "linear_reaction") {
      const input = linearSchemas[name].parse(raw);
      const { client } = await context(input);
      const issue = await checkedIssue(client, input);
      const comment = input.commentId
        ? await client.comment({ id: input.commentId })
        : null;
      if (comment && (await comment.issue)?.id !== issue.id)
        throw new Error("The comment does not belong to this issue.");
      if (input.action === "add")
        assertSuccess(
          await client.createReaction({
            emoji: input.emoji,
            ...(comment ? { commentId: comment.id } : { issueId: issue.id }),
          }),
        );
      else {
        const existing = (comment?.reactions ?? issue.reactions).find(
          (value) =>
            value.id === input.reactionId && value.emoji === input.emoji,
        );
        const viewer = await client.viewer;
        if (!existing || existing.userId !== viewer.id)
          throw new Error("You can only remove your own matching reaction.");
        assertSuccess(await client.deleteReaction(existing.id));
      }
      return refreshAfterWrite(input);
    }
    if (name === "linear_relation") {
      const input = linearSchemas[name].parse(raw);
      const { client } = await context(input);
      const issue = await checkedIssue(client, input);
      if (input.action === "add") {
        if (!input.relatedIssueId) throw new Error("Choose a related issue.");
        const other = await client.issue(input.relatedIssueId);
        if (
          other.id === issue.id ||
          (await (await other.team)?.organization)?.id !== input.workspaceId
        )
          throw new Error("Choose a different issue in the same workspace.");
        assertSuccess(
          await client.createIssueRelation({
            issueId: input.kind === "blocked-by" ? other.id : issue.id,
            relatedIssueId: input.kind === "blocked-by" ? issue.id : other.id,
            type:
              input.kind === "related"
                ? IssueRelationType.Related
                : IssueRelationType.Blocks,
          }),
        );
      } else {
        if (!input.relationId) throw new Error("Choose a relation to remove.");
        const relation = await client.issueRelation(input.relationId);
        if (
          (relation.issueId !== issue.id &&
            relation.relatedIssueId !== issue.id) ||
          !["blocks", "related"].includes(relation.type)
        )
          throw new Error(
            "Only supported relations on this issue can be removed.",
          );
        assertSuccess(await client.deleteIssueRelation(relation.id));
      }
      return refreshAfterWrite(input);
    }
    if (name === "linear_upload") {
      const input = linearSchemas[name].parse(raw);
      const { client } = await context(input);
      const issue = await checkedIssue(client, input);
      const bytes = decodeLinearUpload(input.base64);
      const prepared = await client.fileUpload(
        input.contentType,
        input.filename,
        bytes.length,
      );
      assertSuccess(prepared);
      const file = prepared.uploadFile;
      if (
        !file ||
        new URL(file.uploadUrl).protocol !== "https:" ||
        new URL(file.assetUrl).protocol !== "https:"
      )
        throw new Error("A secure Linear upload URL could not be loaded.");
      const headers = new Headers({
        "Content-Type": input.contentType,
        "Cache-Control": "public, max-age=31536000",
      });
      for (const header of file.headers) headers.set(header.key, header.value);
      const uploaded = await request(file.uploadUrl, {
        method: "PUT",
        headers,
        body: bytes,
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      if (!uploaded.ok)
        throw new Error(
          `The Linear attachment upload failed (${uploaded.status}).`,
        );
      // Refetch before appending so a concurrently edited description is not replaced by our earlier snapshot.
      const latest = await checkedIssue(client, {
        ...input,
        issueId: issue.id,
      });
      const title = input.filename.replace(/[[\]\\\r\n]/g, "_");
      assertSuccess(
        await client.updateIssue(issue.id, {
          description: `${latest.description ?? ""}\n\n[${title}](${file.assetUrl})`,
        }),
      );
      return refreshAfterWrite(input);
    }
    if (name === "linear_bulk") {
      const input = linearSchemas[name].parse(raw);
      await context(input);
      if (
        !input.patch &&
        !input.addLabels?.length &&
        !input.removeLabels?.length
      )
        throw new Error("Choose a property or label for the bulk change.");
      const results = [];
      for (const issueId of [...new Set(input.issueIds)]) {
        let saved = false;
        try {
          const ref = { ...input, issueId };
          const { client } = await context(ref);
          const issue = await checkedIssue(client, ref);
          if (input.patch) {
            assertSuccess(
              await client.updateIssue(
                issue.id,
                await validatePatch(ref, issue, input.patch),
              ),
            );
            saved = true;
          }
          if (input.addLabels?.length || input.removeLabels?.length)
            await changeLabels({
              ...ref,
              requestId: `${input.requestId}:${issueId}`,
              add: input.addLabels ?? [],
              remove: input.removeLabels ?? [],
            });
          results.push({ issueId, success: true, issue: await detail(ref) });
        } catch (error) {
          const issue = await detail({ ...input, issueId }).catch(
            () => undefined,
          );
          results.push({
            issueId,
            success: false,
            ...(issue ? { issue } : {}),
            error: `${saved ? "Properties were saved, but a later change failed. " : "Refresh and check the saved state. "}${
              error instanceof Error
                ? error.message
                : "The Linear bulk change failed."
            }`,
          });
        }
      }
      return { results };
    }
    throw new Error("Unsupported Linear operation.");
  }
  return {
    async call(name, args) {
      const parsed = linearSchemas[name].parse(args);
      if ("requestId" in parsed)
        return once(z.string().parse(parsed.requestId), [name, parsed], () =>
          execute(name, parsed),
        );
      return execute(name, parsed);
    },
  };
}
