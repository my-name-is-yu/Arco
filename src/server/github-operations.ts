import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  githubOperationSchemas as schemas,
  fieldValueSchema,
  reactionContentSchema,
  type BulkUpdateResult,
  type FieldValue,
  type GitHubOperationResult,
  type GitHubOperationToolName,
  type IssueCatalog,
  type IssueFieldList,
  type IssueProjectMemberships,
  type IssueRelations,
  type IssueTemplate,
  type IssueTemplates,
  type LabelDefinition,
  type ProjectChoices,
  type ProjectFieldList,
  type ReactionList,
  type RelatedIssue,
} from "../shared/github-operations";
import {
  issueRefSchema,
  repoSchema,
  type GitHubService,
  type IssueRef,
} from "../shared/contracts";
import { createWriteGuard, GitHubError, runGh, type GhRunner } from "./github";
import { readProjectFields, readProjectMemberships } from "./github-projects";

type Input<K extends GitHubOperationToolName> = z.infer<(typeof schemas)[K]>;
const apiIssueSchema = z.object({
  id: z.number().int().positive(),
  node_id: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  html_url: z.string(),
  repository_url: z.string(),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
  milestone: z.object({ number: z.number() }).nullable().optional(),
  type: z.object({ id: z.number() }).nullable().optional(),
});
const apiLabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  description: z.string().nullable(),
});
const apiCommentSchema = z.object({
  id: z.number(),
  issue_url: z.string(),
  updated_at: z.string(),
});
const changedCommentSchema = apiCommentSchema.extend({
  node_id: z.string(),
  body: z.string(),
  html_url: z.string(),
  user: z.object({ login: z.string() }).nullable(),
});
const apiReactionSchema = z.object({
  id: z.number(),
  content: reactionContentSchema,
  user: z.object({ login: z.string() }).nullable(),
});
const connectionSchema = z.object({
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable().optional(),
  }),
  nodes: z.array(z.unknown()),
});
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new GitHubError("GitHub returned an unexpected response format.");
  return result.data;
}
function invalid(message: string): never {
  throw new GitHubError(message, "invalid");
}
function encoded(value: string) {
  return encodeURIComponent(value);
}
function childRequestId(requestId: string, suffix: string) {
  return `${createHash("sha256").update(requestId).digest("hex").slice(0, 40)}-${suffix}`;
}
function issuePath(ref: IssueRef) {
  return `repos/${ref.repo}/issues/${ref.number}`;
}
function labelDto(label: z.infer<typeof apiLabelSchema>): LabelDefinition {
  return {
    id: String(label.id),
    name: label.name,
    color: label.color,
    description: label.description ?? "",
  };
}
function related(raw: unknown): RelatedIssue {
  const issue = parse(apiIssueSchema, raw);
  if (issue.pull_request !== undefined)
    return invalid("The selection includes a target that is not an issue.");
  const url = new URL(issue.repository_url);
  if (
    url.origin !== "https://api.github.com" ||
    !url.pathname.startsWith("/repos/")
  )
    return invalid("Unable to verify the issue repository.");
  return {
    repo: repoSchema.parse(url.pathname.slice("/repos/".length)),
    number: issue.number,
    id: issue.id,
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
  };
}
function fieldValue(raw: unknown): FieldValue {
  const parsed = fieldValueSchema.safeParse(raw);
  return parsed.success ? parsed.data : (JSON.stringify(raw) ?? null);
}
export function checkFieldValue(
  type: string,
  value: FieldValue,
  options: string[],
  iterations: string[] = [],
) {
  if (value === null) return;
  if (type === "text" && typeof value === "string") return;
  if (type === "number" && typeof value === "number" && Number.isFinite(value))
    return;
  if (
    type === "date" &&
    typeof value === "string" &&
    z.iso.date().safeParse(value).success
  )
    return;
  if (
    type === "single_select" &&
    typeof value === "string" &&
    options.includes(value)
  )
    return;
  if (
    type === "multi_select" &&
    Array.isArray(value) &&
    value.every((name) => options.includes(name))
  )
    return;
  if (
    type === "iteration" &&
    typeof value === "string" &&
    iterations.includes(value)
  )
    return;
  invalid(
    "The value does not match the field type, existing options, or iteration.",
  );
}

export const githubOperationReadOnly = new Set<GitHubOperationToolName>([
  "arco_label_definitions",
  "arco_reactions",
  "arco_issue_catalog",
  "arco_issue_fields",
  "arco_projects",
  "arco_issue_projects",
  "arco_project_fields",
  "arco_issue_relations",
  "arco_issue_templates",
]);

/** Explicit GitHub operations over the public CLI, with no arbitrary endpoint exposed as a tool. */
export function createGitHubOperations(options: {
  service: GitHubService;
  run?: GhRunner;
}) {
  const { service } = options;
  const run = options.run ?? runGh;
  const once = createWriteGuard<GitHubOperationResult | BulkUpdateResult>();
  let fixtureMode: Promise<boolean> | undefined;

  async function api(
    endpoint: string,
    method = "GET",
    body?: unknown,
    paginate = false,
  ): Promise<unknown> {
    if (!options.run) {
      fixtureMode ??= service
        .connection()
        .then((connection) => connection.mode === "fixture");
      if (await fixtureMode)
        throw new GitHubError(
          "This operation requires a live GitHub connection. Local fixture data is never sent to GitHub.",
          "fixture",
        );
    }
    const args = [
      "api",
      "--hostname",
      "github.com",
      endpoint,
      "--method",
      method,
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2026-03-10",
    ];
    if (paginate) args.push("--paginate", "--slurp");
    if (body !== undefined) args.push("--input", "-");
    let result: unknown;
    try {
      result = await run(
        args,
        body === undefined ? undefined : JSON.stringify(body),
      );
    } catch (error) {
      if (
        method !== "GET" &&
        !(
          endpoint === "graphql" &&
          typeof body === "object" &&
          body !== null &&
          "query" in body &&
          typeof body.query === "string" &&
          body.query.trimStart().startsWith("query")
        )
      )
        throw new GitHubError(
          "Unable to confirm the update. Check GitHub and refresh before retrying.",
          "uncertain",
        );
      throw error instanceof GitHubError
        ? error
        : new GitHubError("Unable to load information from GitHub.");
    }
    if (result && typeof result === "object" && "errors" in result)
      throw new GitHubError(
        "Unable to verify the GitHub Projects permissions, target, or response.",
        endpoint === "graphql" &&
          typeof body === "object" &&
          body !== null &&
          "query" in body &&
          typeof body.query === "string" &&
          body.query.trimStart().startsWith("mutation")
          ? "uncertain"
          : "forbidden",
      );
    return result;
  }
  async function graphql(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await api("graphql", "POST", { query, variables });
    } catch (error) {
      if (
        query.trimStart().startsWith("query") &&
        error instanceof GitHubError &&
        error.code === "forbidden"
      )
        throw new GitHubError(
          "Unable to load Projects. Check read:project in GitHub CLI and your access to the target.",
          "forbidden",
        );
      throw error;
    }
  }
  async function pages<T>(
    endpoint: string,
    schema: z.ZodType<T>,
  ): Promise<T[]> {
    return parse(
      z.array(z.array(schema)),
      await api(endpoint, "GET", undefined, true),
    ).flat();
  }
  async function issueRecord(raw: IssueRef) {
    const ref = issueRefSchema.parse(raw);
    const issue = parse(apiIssueSchema, await api(issuePath(ref)));
    if (issue.pull_request !== undefined)
      return invalid("This target is not an issue.");
    if (
      issue.number !== ref.number ||
      issue.repository_url.toLowerCase() !==
        `https://api.github.com/repos/${ref.repo}`.toLowerCase()
    )
      throw new GitHubError(
        "The issue repository or number has changed.",
        "conflict",
      );
    return issue;
  }
  async function refresh(ref: IssueRef): Promise<GitHubOperationResult> {
    try {
      return { ...ref, issue: await service.get(ref) };
    } catch {
      throw new GitHubError(
        "The change was saved, but the issue could not be refreshed. Refresh without repeating the update.",
        "refresh",
      );
    }
  }
  async function commentRecord(
    ref: IssueRef,
    commentId: number,
    expected?: string,
  ) {
    await issueRecord(ref);
    const comment = parse(
      apiCommentSchema,
      await api(`repos/${ref.repo}/issues/comments/${commentId}`),
    );
    if (
      comment.id !== commentId ||
      comment.issue_url.toLowerCase() !==
        `https://api.github.com/${issuePath(ref)}`.toLowerCase()
    )
      return invalid("This comment does not belong to the selected issue.");
    if (expected && expected !== comment.updated_at)
      throw new GitHubError(
        "This comment has changed. Keep your draft and refresh.",
        "conflict",
      );
    return comment;
  }
  async function repoOwner(repo: string) {
    const response = parse(
      z.object({
        full_name: z.string(),
        owner: z.object({ login: z.string(), type: z.string() }),
      }),
      await api(`repos/${repo}`),
    );
    if (response.full_name.toLowerCase() !== repo.toLowerCase())
      throw new GitHubError("The repository location has changed.", "conflict");
    return response.owner;
  }

  async function labelDefinitions(input: Input<"arco_label_definitions">) {
    return {
      repo: input.repo,
      labels: (
        await pages(`repos/${input.repo}/labels?per_page=100`, apiLabelSchema)
      ).map(labelDto),
    };
  }
  function createLabel(input: Input<"arco_create_label">) {
    return once(input.requestId, ["createLabel", input], async () => ({
      repo: input.repo,
      label: labelDto(
        parse(
          apiLabelSchema,
          await api(`repos/${input.repo}/labels`, "POST", {
            name: input.name,
            color: input.color,
            description: input.description,
          }),
        ),
      ),
    }));
  }
  function updateLabel(input: Input<"arco_update_label">) {
    return once(input.requestId, ["updateLabel", input], async () => {
      if (!Object.keys(input.patch).length)
        return invalid("Select the label definition fields to change.");
      const { name, ...patch } = input.patch;
      return {
        repo: input.repo,
        label: labelDto(
          parse(
            apiLabelSchema,
            await api(
              `repos/${input.repo}/labels/${encoded(input.name)}`,
              "PATCH",
              { ...patch, ...(name !== undefined ? { new_name: name } : {}) },
            ),
          ),
        ),
      };
    });
  }
  function deleteLabel(input: Input<"arco_delete_label">) {
    return once(input.requestId, ["deleteLabel", input], async () => {
      await api(`repos/${input.repo}/labels/${encoded(input.name)}`, "DELETE");
      return { repo: input.repo, deleted: true };
    });
  }
  function editComment(input: Input<"arco_edit_comment">) {
    return once(input.requestId, ["editComment", input], async () => {
      await commentRecord(input, input.commentId, input.expectedUpdatedAt);
      const changed = parse(
        changedCommentSchema,
        await api(
          `repos/${input.repo}/issues/comments/${input.commentId}`,
          "PATCH",
          { body: input.body },
        ),
      );
      if (
        changed.id !== input.commentId ||
        changed.issue_url.toLowerCase() !==
          `https://api.github.com/${issuePath(input)}`.toLowerCase()
      )
        return invalid("GitHub returned a different comment after editing.");
      return {
        ...(await refresh(input)),
        changedComment: {
          id: changed.node_id,
          databaseId: changed.id,
          body: changed.body,
          author: changed.user?.login ?? "ghost",
          url: changed.html_url,
          updatedAt: changed.updated_at,
        },
      };
    });
  }
  function deleteComment(input: Input<"arco_delete_comment">) {
    return once(input.requestId, ["deleteComment", input], async () => {
      await commentRecord(input, input.commentId, input.expectedUpdatedAt);
      await api(
        `repos/${input.repo}/issues/comments/${input.commentId}`,
        "DELETE",
      );
      return { ...(await refresh(input)), deleted: true };
    });
  }
  async function reactionEndpoint(input: IssueRef & { commentId?: number }) {
    if (input.commentId !== undefined) {
      await commentRecord(input, input.commentId);
      return `repos/${input.repo}/issues/comments/${input.commentId}/reactions`;
    }
    await issueRecord(input);
    return `${issuePath(input)}/reactions`;
  }
  async function reactions(
    input: Input<"arco_reactions">,
  ): Promise<ReactionList> {
    const endpoint = await reactionEndpoint(input);
    const [items, connection] = await Promise.all([
      pages(`${endpoint}?per_page=100`, apiReactionSchema),
      service.connection(),
    ]);
    return {
      repo: input.repo,
      number: input.number,
      ...(input.commentId !== undefined ? { commentId: input.commentId } : {}),
      reactions: items.map((item) => ({
        id: item.id,
        content: item.content,
        author: item.user?.login ?? "ghost",
      })),
      account: connection.account,
    };
  }
  function addReaction(input: Input<"arco_add_reaction">) {
    return once(input.requestId, ["addReaction", input], async () => {
      const endpoint = await reactionEndpoint(input);
      await api(endpoint, "POST", { content: input.content });
      return refresh(input);
    });
  }
  function removeReaction(input: Input<"arco_remove_reaction">) {
    return once(input.requestId, ["removeReaction", input], async () => {
      const current = await reactions(input);
      if (
        !current.account ||
        !current.reactions.some(
          (item) =>
            item.id === input.reactionId &&
            item.author.toLowerCase() === current.account?.toLowerCase(),
        )
      )
        return invalid(
          "You can only remove your own reaction from this target.",
        );
      const endpoint =
        input.commentId === undefined
          ? `${issuePath(input)}/reactions`
          : `repos/${input.repo}/issues/comments/${input.commentId}/reactions`;
      await api(`${endpoint}/${input.reactionId}`, "DELETE");
      return refresh(input);
    });
  }
  async function issueCatalog(
    input: Input<"arco_issue_catalog">,
  ): Promise<IssueCatalog> {
    const [issue, owner] = await Promise.all([
      issueRecord(input),
      repoOwner(input.repo),
    ]);
    const errors: string[] = [];
    const milestones = await pages(
      `repos/${input.repo}/milestones?state=all&per_page=100`,
      z.object({
        number: z.number(),
        title: z.string(),
        state: z.enum(["open", "closed"]),
      }),
    );
    let issueTypes: IssueCatalog["issueTypes"] = [];
    if (owner.type === "Organization") {
      try {
        issueTypes = parse(
          z.array(
            z.object({
              id: z.number(),
              name: z.string(),
              description: z.string().nullable().optional(),
            }),
          ),
          await api(`orgs/${owner.login}/issue-types`),
        ).map((type) => ({
          id: type.id,
          name: type.name,
          description: type.description ?? "",
        }));
      } catch {
        errors.push(
          "Unable to load issue types. Check your access to Issue Types in this organization.",
        );
      }
    }
    return {
      repo: input.repo,
      number: input.number,
      milestoneNumber: issue.milestone?.number ?? null,
      issueTypeId: issue.type?.id ?? null,
      milestones,
      issueTypes,
      errors,
    };
  }
  function issueAttributes(input: Input<"arco_issue_attributes">) {
    return once(input.requestId, ["issueAttributes", input], async () => {
      if (!Object.keys(input.patch).length)
        return invalid("Select the attributes to change.");
      const issue = await issueRecord(input);
      if (
        input.expectedUpdatedAt &&
        input.expectedUpdatedAt !== issue.updated_at
      )
        throw new GitHubError(
          "This issue has changed. Refresh before saving.",
          "conflict",
        );
      const catalog = await issueCatalog(input);
      const { milestoneNumber, issueTypeId } = input.patch;
      if (
        milestoneNumber != null &&
        !catalog.milestones.some((item) => item.number === milestoneNumber)
      )
        return invalid("Select an existing milestone in this repository.");
      const issueType =
        issueTypeId == null
          ? null
          : catalog.issueTypes.find((item) => item.id === issueTypeId);
      if (issueTypeId != null && !issueType)
        return invalid("Select an existing issue type in this organization.");
      await api(issuePath(input), "PATCH", {
        ...(milestoneNumber !== undefined
          ? { milestone: milestoneNumber }
          : {}),
        ...(issueTypeId !== undefined ? { type: issueType?.name ?? null } : {}),
      });
      const saved = await issueRecord(input);
      if (
        (milestoneNumber !== undefined &&
          (saved.milestone?.number ?? null) !== milestoneNumber) ||
        (issueTypeId !== undefined && (saved.type?.id ?? null) !== issueTypeId)
      )
        throw new GitHubError(
          "The saved attributes do not match your selection. Check your permissions and refresh.",
          "not-applied",
        );
      return refresh(input);
    });
  }
  async function issueFields(
    input: Input<"arco_issue_fields">,
  ): Promise<IssueFieldList> {
    await issueRecord(input);
    const owner = await repoOwner(input.repo);
    if (owner.type !== "Organization")
      return {
        repo: input.repo,
        number: input.number,
        organization: null,
        fields: [],
      };
    const definitions = parse(
      z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          data_type: z.string(),
          options: z
            .array(z.object({ id: z.number(), name: z.string() }))
            .optional(),
        }),
      ),
      await api(`orgs/${owner.login}/issue-fields`),
    );
    const values = await pages(
      `${issuePath(input)}/issue-field-values?per_page=100`,
      z.object({
        issue_field_id: z.number(),
        value: z.unknown(),
        single_select_option: z.object({ name: z.string() }).optional(),
        multi_select_options: z
          .array(z.object({ name: z.string() }))
          .optional(),
      }),
    );
    return {
      repo: input.repo,
      number: input.number,
      organization: owner.login,
      fields: definitions.map((definition) => {
        const current = values.find(
          (value) => value.issue_field_id === definition.id,
        );
        return {
          id: definition.id,
          name: definition.name,
          type: definition.data_type,
          supported: [
            "text",
            "number",
            "date",
            "single_select",
            "multi_select",
          ].includes(definition.data_type),
          options: definition.options ?? [],
          value: current
            ? (current.multi_select_options?.map((option) => option.name) ??
              current.single_select_option?.name ??
              fieldValue(current.value))
            : null,
        };
      }),
    };
  }
  function setIssueField(input: Input<"arco_set_issue_field">) {
    return once(input.requestId, ["setIssueField", input], async () => {
      const field = (await issueFields(input)).fields.find(
        (item) => item.id === input.fieldId,
      );
      if (!field?.supported)
        return invalid(
          "Select an existing supported Issue field. Its ID is separate from Project fields.",
        );
      checkFieldValue(
        field.type,
        input.value,
        field.options.map((option) => option.name),
      );
      if (input.value === null) {
        if (field.value !== null)
          await api(
            `${issuePath(input)}/issue-field-values/${field.id}`,
            "DELETE",
          );
      } else
        await api(`${issuePath(input)}/issue-field-values`, "POST", {
          issue_field_values: [{ field_id: field.id, value: input.value }],
        });
      return refresh(input);
    });
  }

  async function projects(
    input: Input<"arco_projects">,
  ): Promise<ProjectChoices> {
    const owner = input.owner ?? input.repo.split("/")[0];
    const query = `query ArcoProjects($owner:String!,$cursor:String){ ${input.ownerType}(login:$owner){ projectsV2(first:50,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id number title url closed}}}}`;
    const response = parse(
      z.object({ data: z.record(z.string(), z.unknown()) }),
      await graphql(query, { owner, cursor: input.cursor ?? null }),
    );
    const account = parse(
      z.object({ projectsV2: connectionSchema }),
      response.data[input.ownerType],
    );
    return {
      repo: input.repo,
      owner,
      ownerType: input.ownerType,
      projects: account.projectsV2.nodes.map((item) =>
        parse(
          z.object({
            id: z.string(),
            number: z.number(),
            title: z.string(),
            url: z.string(),
            closed: z.boolean(),
          }),
          item,
        ),
      ),
      hasMore: account.projectsV2.pageInfo.hasNextPage,
      cursor: account.projectsV2.pageInfo.endCursor ?? null,
    };
  }
  async function issueProjects(
    input: Input<"arco_issue_projects">,
  ): Promise<IssueProjectMemberships> {
    const issue = await issueRecord(input);
    return {
      repo: input.repo,
      number: input.number,
      memberships: await readProjectMemberships(graphql, input, issue.node_id),
      errors: [],
    };
  }
  function projectMembership(input: Input<"arco_project_membership">) {
    return once(input.requestId, ["projectMembership", input], async () => {
      const issue = await issueRecord(input);
      if (input.action === "add") {
        const project = parse(
          z.object({
            data: z.object({ node: z.object({ id: z.string() }).nullable() }),
          }),
          await graphql(
            "query ArcoProjectIdentity($id:ID!){node(id:$id){... on ProjectV2{id}}}",
            { id: input.projectId },
          ),
        );
        if (project.data.node?.id !== input.projectId)
          return invalid("Select an existing Project you can access.");
        const response = parse(
          z.object({
            data: z.object({
              addProjectV2ItemById: z.object({
                item: z.object({ id: z.string() }),
              }),
            }),
          }),
          await graphql(
            "mutation ArcoAddProject($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}",
            { projectId: input.projectId, contentId: issue.node_id },
          ),
        );
        return {
          ...(await refresh(input)),
          projectItemId: response.data.addProjectV2ItemById.item.id,
        };
      }
      const membership = (await issueProjects(input)).memberships.find(
        (item) =>
          item.projectId === input.projectId && item.itemId === input.itemId,
      );
      if (!membership)
        return invalid("The issue, Project, and item do not belong together.");
      await graphql(
        "mutation ArcoRemoveProject($projectId:ID!,$itemId:ID!){deleteProjectV2Item(input:{projectId:$projectId,itemId:$itemId}){deletedItemId}}",
        { projectId: input.projectId, itemId: membership.itemId },
      );
      return refresh(input);
    });
  }

  async function projectFields(
    input: Input<"arco_project_fields">,
  ): Promise<ProjectFieldList> {
    const issue = await issueRecord(input);
    const fields = await readProjectFields(graphql, {
      projectId: input.projectId,
      itemId: input.itemId,
      issueId: issue.node_id,
    });
    return {
      repo: input.repo,
      number: input.number,
      projectId: input.projectId,
      itemId: input.itemId,
      fields,
      hasMore: false,
    };
  }
  function setProjectField(input: Input<"arco_set_project_field">) {
    return once(input.requestId, ["setProjectField", input], async () => {
      const field = (await projectFields(input)).fields.find(
        (item) => item.id === input.fieldId,
      );
      if (!field?.supported)
        return invalid(
          "Select an existing supported Project field. Its ID is separate from organization Issue fields.",
        );
      checkFieldValue(
        field.type,
        input.value,
        field.options.map((option) => option.id),
        field.iterations.map((iteration) => iteration.id),
      );
      const variables = {
        projectId: input.projectId,
        itemId: input.itemId,
        fieldId: input.fieldId,
      };
      if (input.value === null)
        await graphql(
          "mutation ArcoClearProjectField($projectId:ID!,$itemId:ID!,$fieldId:ID!){clearProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId}){projectV2Item{id}}}",
          variables,
        );
      else {
        const key = {
          text: "text",
          number: "number",
          date: "date",
          single_select: "singleSelectOptionId",
          iteration: "iterationId",
        }[field.type];
        if (!key) return invalid("This field type is not supported.");
        await graphql(
          "mutation ArcoSetProjectField($projectId:ID!,$itemId:ID!,$fieldId:ID!,$value:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:$value}){projectV2Item{id}}}",
          { ...variables, value: { [key]: input.value } },
        );
      }
      return refresh(input);
    });
  }

  async function issueRelations(
    input: Input<"arco_issue_relations">,
  ): Promise<IssueRelations> {
    await issueRecord(input);
    const errors: string[] = [];
    let parent: RelatedIssue | null = null;
    try {
      parent = related(await api(`${issuePath(input)}/parent`));
    } catch (error) {
      if (!(error instanceof GitHubError && error.code === "not-found"))
        errors.push("Unable to load the parent issue.");
    }
    const lists = await Promise.all(
      ["sub_issues", "dependencies/blocked_by", "dependencies/blocking"].map(
        async (path) => {
          try {
            return (
              await pages(
                `${issuePath(input)}/${path}?per_page=100`,
                apiIssueSchema,
              )
            ).map(related);
          } catch {
            errors.push(`Unable to load ${path}.`);
            return [];
          }
        },
      ),
    );
    return {
      repo: input.repo,
      number: input.number,
      parent,
      children: lists[0],
      blockedBy: lists[1],
      blocking: lists[2],
      errors,
    };
  }
  function checkDifferent(a: IssueRef, b: IssueRef) {
    if (a.repo.toLowerCase() === b.repo.toLowerCase() && a.number === b.number)
      return invalid(
        "An issue cannot be its own parent, child, or dependency.",
      );
  }
  function setParent(input: Input<"arco_set_parent">) {
    return once(input.requestId, ["setParent", input], async () => {
      checkDifferent(input, input.parent);
      if (
        input.repo.split("/")[0].toLowerCase() !==
        input.parent.repo.split("/")[0].toLowerCase()
      )
        return invalid(
          "Parent and child issues must have the same repository owner.",
        );
      const [child] = await Promise.all([
        issueRecord(input),
        issueRecord(input.parent),
      ]);
      await api(`${issuePath(input.parent)}/sub_issues`, "POST", {
        sub_issue_id: child.id,
        replace_parent: input.replace,
      });
      return refresh(input);
    });
  }
  function removeParent(input: Input<"arco_remove_parent">) {
    return once(input.requestId, ["removeParent", input], async () => {
      checkDifferent(input, input.parent);
      const child = await issueRecord(input);
      await issueRecord(input.parent);
      const actual = related(await api(`${issuePath(input)}/parent`));
      if (
        actual.repo.toLowerCase() !== input.parent.repo.toLowerCase() ||
        actual.number !== input.parent.number
      )
        return invalid(
          "The selected parent does not match the current parent issue.",
        );
      await api(`${issuePath(input.parent)}/sub_issue`, "DELETE", {
        sub_issue_id: child.id,
      });
      return refresh(input);
    });
  }
  function createSubIssue(input: Input<"arco_create_sub_issue">) {
    return once(input.requestId, ["createSubIssue", input], async () => {
      await issueRecord(input);
      if (
        input.repo.split("/")[0].toLowerCase() !==
        input.childRepo.split("/")[0].toLowerCase()
      )
        return invalid(
          "Create the child issue under the same repository owner as its parent.",
        );
      const createdIssue = await service.create({
        repo: input.childRepo,
        requestId: childRequestId(input.requestId, "child"),
        title: input.title,
        body: input.body,
      });
      try {
        const child = await issueRecord(createdIssue);
        await api(`${issuePath(input)}/sub_issues`, "POST", {
          sub_issue_id: child.id,
        });
      } catch {
        throw new GitHubError(
          `Child issue ${createdIssue.repo} #${createdIssue.number} was created, but its parent relationship could not be confirmed. Check ${createdIssue.url} and do not create it again.`,
          "partial",
        );
      }
      return { ...(await refresh(input)), createdIssue };
    });
  }
  function addDependency(input: Input<"arco_add_dependency">) {
    return once(input.requestId, ["addDependency", input], async () => {
      checkDifferent(input, input.blockedBy);
      const [, blocker] = await Promise.all([
        issueRecord(input),
        issueRecord(input.blockedBy),
      ]);
      await api(`${issuePath(input)}/dependencies/blocked_by`, "POST", {
        issue_id: blocker.id,
      });
      return refresh(input);
    });
  }
  function removeDependency(input: Input<"arco_remove_dependency">) {
    return once(input.requestId, ["removeDependency", input], async () => {
      checkDifferent(input, input.blockedBy);
      const [, blocker] = await Promise.all([
        issueRecord(input),
        issueRecord(input.blockedBy),
      ]);
      const existing = await pages(
        `${issuePath(input)}/dependencies/blocked_by?per_page=100`,
        apiIssueSchema,
      );
      if (!existing.some((issue) => issue.id === blocker.id))
        return invalid(
          "The selected issue is not an existing blocked-by dependency.",
        );
      await api(
        `${issuePath(input)}/dependencies/blocked_by/${blocker.id}`,
        "DELETE",
      );
      return refresh(input);
    });
  }
  async function issueTemplates(
    input: Input<"arco_issue_templates">,
  ): Promise<IssueTemplates> {
    const official = `https://github.com/${input.repo}/issues/new/choose`;
    let templateRepo = input.repo;
    let files: {
      name: string;
      path: string;
      html_url: string | null;
      type: string;
    }[];
    try {
      files = parse(
        z.array(
          z.object({
            name: z.string(),
            path: z.string(),
            html_url: z.string().nullable(),
            type: z.string(),
          }),
        ),
        await api(`repos/${input.repo}/contents/.github/ISSUE_TEMPLATE`),
      );
    } catch (error) {
      if (!(error instanceof GitHubError) || error.code !== "not-found")
        throw error;
      // GitHub inherits templates only from the owner's public .github repository.
      const defaultsRepo = `${input.repo.split("/")[0]}/.github`;
      if (defaultsRepo.toLowerCase() === input.repo.toLowerCase())
        return { repo: input.repo, templates: [] };
      try {
        const repository = parse(
          z.object({ private: z.boolean(), full_name: z.string() }),
          await api(`repos/${defaultsRepo}`),
        );
        if (
          repository.private ||
          repository.full_name.toLowerCase() !== defaultsRepo.toLowerCase()
        )
          return { repo: input.repo, templates: [] };
        templateRepo = defaultsRepo;
        files = parse(
          z.array(
            z.object({
              name: z.string(),
              path: z.string(),
              html_url: z.string().nullable(),
              type: z.string(),
            }),
          ),
          await api(`repos/${templateRepo}/contents/.github/ISSUE_TEMPLATE`),
        );
      } catch (fallbackError) {
        if (
          fallbackError instanceof GitHubError &&
          fallbackError.code === "not-found"
        )
          return { repo: input.repo, templates: [] };
        throw fallbackError;
      }
    }
    const templates: IssueTemplate[] = [];
    for (const file of files) {
      if (
        file.type !== "file" ||
        file.name === "config.yml" ||
        file.name === "config.yaml"
      )
        continue;
      if (!/\.md$/i.test(file.name)) {
        templates.push({
          path: file.path,
          name: file.name,
          description: "",
          kind: "unsupported",
          reason:
            "Use GitHub for form templates or unsupported template formats.",
          url: official,
        });
        continue;
      }
      const contents = parse(
        z.object({ content: z.string(), encoding: z.literal("base64") }),
        await api(
          `repos/${templateRepo}/contents/${file.path.split("/").map(encoded).join("/")}`,
        ),
      );
      templates.push(
        classifyMarkdownTemplate(
          file.path,
          Buffer.from(contents.content, "base64").toString("utf8"),
          official,
        ),
      );
    }
    return { repo: input.repo, templates };
  }

  function bulkUpdate(input: Input<"arco_bulk_update">) {
    return once(input.requestId, ["bulkUpdate", input], async () => {
      const repo = input.issues[0].repo.toLowerCase();
      if (
        input.issues.some((issue) => issue.repo.toLowerCase() !== repo) ||
        new Set(input.issues.map((issue) => issue.number)).size !==
          input.issues.length
      )
        return invalid(
          "Bulk changes require distinct issues from the same repository. Field, label, and assignee scopes must be explicit.",
        );
      if (
        !input.patch &&
        !input.labels &&
        !input.issueField &&
        !input.projectField
      )
        return invalid("Select what to change in bulk.");
      const results: BulkUpdateResult["results"] = [];
      for (const [index, ref] of input.issues.entries()) {
        const key = childRequestId(input.requestId, String(index));
        try {
          const { milestoneNumber, issueTypeId, ...patch } = input.patch ?? {};
          if (Object.keys(patch).length)
            await service.update({ ...ref, requestId: `${key}-issue`, patch });
          if (milestoneNumber !== undefined || issueTypeId !== undefined)
            await issueAttributes({
              ...ref,
              requestId: `${key}-attrs`,
              patch: {
                ...(milestoneNumber !== undefined ? { milestoneNumber } : {}),
                ...(issueTypeId !== undefined ? { issueTypeId } : {}),
              },
            });
          if (input.labels)
            await service.labels({
              ...ref,
              requestId: `${key}-labels`,
              ...input.labels,
            });
          if (input.issueField)
            await setIssueField({
              ...ref,
              requestId: `${key}-field`,
              ...input.issueField,
            });
          if (input.projectField) {
            const membership = (await issueProjects(ref)).memberships.find(
              (item) => item.projectId === input.projectField?.projectId,
            );
            if (!membership)
              return invalid("An issue is not in the selected Project.");
            await setProjectField({
              ...ref,
              requestId: `${key}-project`,
              ...input.projectField,
              itemId: membership.itemId,
            });
          }
          results.push({ ...ref, ok: true, issue: await service.get(ref) });
        } catch (error) {
          results.push({
            ...ref,
            ok: false,
            error:
              error instanceof GitHubError
                ? error.message
                : "This issue could not be updated. Some changes may have been applied; refresh to check the result.",
          });
        }
      }
      return { results };
    });
  }
  return {
    labelDefinitions,
    createLabel,
    updateLabel,
    deleteLabel,
    editComment,
    deleteComment,
    reactions,
    addReaction,
    removeReaction,
    issueCatalog,
    issueAttributes,
    issueFields,
    setIssueField,
    projects,
    issueProjects,
    projectMembership,
    projectFields,
    setProjectField,
    issueRelations,
    setParent,
    removeParent,
    createSubIssue,
    addDependency,
    removeDependency,
    issueTemplates,
    bulkUpdate,
  };
}

/** Conservatively classify only flat Markdown templates; never discard unknown required behavior. */
export function classifyMarkdownTemplate(
  path: string,
  source: string,
  url: string,
): IssueTemplate {
  const fallback: IssueTemplate = {
    path,
    name: path.split("/").at(-1) ?? path,
    description: "",
    kind: "unsupported",
    url,
    reason: "Use GitHub for templates with unsupported settings.",
  };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return fallback;
  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const entry = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (
      !entry ||
      !["name", "about", "title", "labels", "assignees", "type"].includes(
        entry[1],
      ) ||
      entry[1] in metadata
    )
      return fallback;
    const raw = entry[2];
    if ((raw.length > 0 && "[]{}>&*!|".includes(raw[0])) || /\s#/.test(raw))
      return fallback;
    let value = raw;
    if (raw.startsWith('"')) {
      try {
        const decoded: unknown = JSON.parse(raw);
        if (typeof decoded !== "string") return fallback;
        value = decoded;
      } catch {
        return fallback;
      }
    } else if (raw.startsWith("'")) {
      if (!raw.endsWith("'")) return fallback;
      value = raw.slice(1, -1).replaceAll("''", "'");
    } else if (
      [...raw].some((char) => ":[]{}".includes(char)) ||
      /^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(raw)
    )
      return fallback;
    metadata[entry[1]] = value;
  }
  if (!metadata.name) return fallback;
  return {
    path,
    name: metadata.name,
    description: metadata.about ?? "",
    kind: "simple",
    url,
    body: match[2],
    defaults: {
      title: metadata.title ?? "",
      ...(metadata.type ? { type: metadata.type } : {}),
      labels: (metadata.labels ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      assignees: (metadata.assignees ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    },
  };
}

export async function callGitHubOperation(
  operations: ReturnType<typeof createGitHubOperations>,
  name: GitHubOperationToolName,
  args: unknown,
): Promise<object> {
  switch (name) {
    case "arco_label_definitions":
      return operations.labelDefinitions(schemas[name].parse(args));
    case "arco_create_label":
      return operations.createLabel(schemas[name].parse(args));
    case "arco_update_label":
      return operations.updateLabel(schemas[name].parse(args));
    case "arco_delete_label":
      return operations.deleteLabel(schemas[name].parse(args));
    case "arco_edit_comment":
      return operations.editComment(schemas[name].parse(args));
    case "arco_delete_comment":
      return operations.deleteComment(schemas[name].parse(args));
    case "arco_reactions":
      return operations.reactions(schemas[name].parse(args));
    case "arco_add_reaction":
      return operations.addReaction(schemas[name].parse(args));
    case "arco_remove_reaction":
      return operations.removeReaction(schemas[name].parse(args));
    case "arco_issue_catalog":
      return operations.issueCatalog(schemas[name].parse(args));
    case "arco_issue_attributes":
      return operations.issueAttributes(schemas[name].parse(args));
    case "arco_issue_fields":
      return operations.issueFields(schemas[name].parse(args));
    case "arco_set_issue_field":
      return operations.setIssueField(schemas[name].parse(args));
    case "arco_projects":
      return operations.projects(schemas[name].parse(args));
    case "arco_issue_projects":
      return operations.issueProjects(schemas[name].parse(args));
    case "arco_project_membership":
      return operations.projectMembership(schemas[name].parse(args));
    case "arco_project_fields":
      return operations.projectFields(schemas[name].parse(args));
    case "arco_set_project_field":
      return operations.setProjectField(schemas[name].parse(args));
    case "arco_issue_relations":
      return operations.issueRelations(schemas[name].parse(args));
    case "arco_set_parent":
      return operations.setParent(schemas[name].parse(args));
    case "arco_remove_parent":
      return operations.removeParent(schemas[name].parse(args));
    case "arco_create_sub_issue":
      return operations.createSubIssue(schemas[name].parse(args));
    case "arco_add_dependency":
      return operations.addDependency(schemas[name].parse(args));
    case "arco_remove_dependency":
      return operations.removeDependency(schemas[name].parse(args));
    case "arco_issue_templates":
      return operations.issueTemplates(schemas[name].parse(args));
    case "arco_bulk_update":
      return operations.bulkUpdate(schemas[name].parse(args));
  }
}
