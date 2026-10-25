import { createHash } from "node:crypto";
import type { GitHubService, IssueRef } from "../shared/contracts";
import {
  type BulkUpdateResult,
  type FieldValue,
  type GitHubOperationResult,
  type IssueCatalog,
  type IssueField,
  type IssueFieldList,
  type IssueProjectMemberships,
  type IssueRelations,
  type IssueTemplate,
  type LabelDefinition,
  type ProjectChoice,
  type ProjectField,
  type ProjectFieldList,
  type Reaction,
  type RelatedIssue,
} from "../shared/github-operations";
import { FIXTURE_REPO, isFixtureGitHubService } from "./fixture";
import { GitHubError } from "./github";
import {
  checkFieldValue,
  type createGitHubOperations,
} from "./github-operations";
import { createGitHubWriteGuard } from "./github/transport";

interface Membership {
  projectId: string;
  itemId: string;
  title: string;
  url: string;
  values: Map<string, FieldValue>;
}
interface Extras {
  milestoneNumber: number | null;
  issueTypeId: number | null;
  fields: Map<number, FieldValue>;
  memberships: Membership[];
  parent: IssueRef | null;
  blockedBy: IssueRef[];
}
const projectChoices: ProjectChoice[] = [
  {
    id: "fixture-project",
    number: 1,
    title: "Arco implementation",
    url: "https://github.com/users/yu/projects/1",
    closed: false,
  },
  {
    id: "fixture-project-notes",
    number: 2,
    title: "Research notes",
    url: "https://github.com/users/yu/projects/2",
    closed: false,
  },
];
const issueDefinitions: IssueField[] = [
  {
    id: 101,
    name: "Summary",
    type: "text",
    supported: true,
    value: null,
    options: [],
  },
  {
    id: 102,
    name: "Points",
    type: "number",
    supported: true,
    value: null,
    options: [],
  },
  {
    id: 103,
    name: "Due date",
    type: "date",
    supported: true,
    value: null,
    options: [],
  },
  {
    id: 104,
    name: "Priority",
    type: "single_select",
    supported: true,
    value: null,
    options: [
      { id: 1, name: "High", color: "red" },
      { id: 2, name: "Normal", color: "gray" },
    ],
  },
  {
    id: 105,
    name: "Area",
    type: "multi_select",
    supported: true,
    value: null,
    options: [
      { id: 3, name: "Frontend", color: "blue" },
      { id: 4, name: "Server", color: "green" },
    ],
  },
  {
    id: 106,
    name: "Source-managed field",
    type: "people",
    supported: false,
    value: "Read only",
    options: [],
  },
];
const milestones: IssueCatalog["milestones"] = [
  { number: 1, title: "First implementation", state: "open" },
  { number: 2, title: "Protocol probe", state: "closed" },
];
const issueTypes: IssueCatalog["issueTypes"] = [
  {
    id: 1,
    name: "Task",
    description: "A bounded implementation task",
    color: "blue",
  },
  { id: 2, name: "Bug", description: "A reproduced problem", color: "red" },
];
const key = (ref: IssueRef) => `${ref.repo.toLowerCase()}#${ref.number}`;
function invalid(message: string): never {
  throw new GitHubError(message, "invalid");
}
function projectDefinitions(projectId: string): ProjectField[] {
  const definitions: ProjectField[] = [
    {
      id: "fixture-project-text",
      name: "Notes",
      type: "text",
      supported: true,
      value: null,
      options: [],
      iterations: [],
    },
    {
      id: "fixture-project-number",
      name: "Effort",
      type: "number",
      supported: true,
      value: null,
      options: [],
      iterations: [],
    },
    {
      id: "fixture-project-date",
      name: "Target date",
      type: "date",
      supported: true,
      value: null,
      options: [],
      iterations: [],
    },
    {
      id: "fixture-project-iteration",
      name: "Iteration",
      type: "iteration",
      supported: true,
      value: null,
      options: [],
      iterations: [
        {
          id: "fixture-iteration-1",
          title: "October 1",
          startDate: "2026-10-19",
          duration: 14,
        },
        {
          id: "fixture-iteration-2",
          title: "November 1",
          startDate: "2026-11-02",
          duration: 14,
        },
      ],
    },
  ];
  if (projectId === "fixture-project")
    definitions.unshift({
      id: "fixture-status-field",
      name: "Status",
      type: "single_select",
      supported: true,
      value: null,
      options: [
        { id: "fixture-status-todo", name: "Todo", color: "GRAY" },
        { id: "fixture-status-progress", name: "In progress", color: "BLUE" },
        { id: "fixture-status-done", name: "Done", color: "GREEN" },
      ],
      iterations: [],
    });
  return definitions;
}

/** Development-only mutations. This factory has no CLI runner or live-network fallback. */
export function createFixtureGitHubOperations(options: {
  service: GitHubService;
}): ReturnType<typeof createGitHubOperations> {
  if (!isFixtureGitHubService(options.service))
    throw new GitHubError(
      "Advanced fixture operations require a fixture service.",
      "fixture",
    );
  const service = options.service;
  const extras = new Map<string, Extras>();
  const reactionTargets = new Map<string, Reaction[]>();
  const once = createGitHubWriteGuard<
    GitHubOperationResult | BulkUpdateResult
  >();
  let labelSequence = 100;
  let reactionSequence = 1;
  async function state(ref: IssueRef) {
    const issue = await service.get(ref);
    let value = extras.get(key(ref));
    if (!value) {
      value = {
        milestoneNumber: ref.number === 42 ? 1 : null,
        issueTypeId: issue.issueType?.id ?? 1,
        fields: new Map([[104, "Normal"]]),
        parent: null,
        blockedBy: [],
        memberships: issue.projects.map((project) => ({
          projectId: project.projectId,
          itemId: project.itemId,
          title: project.projectTitle,
          url: `https://github.com/users/yu/projects/1`,
          values: new Map([[project.fieldId, project.optionId]]),
        })),
      };
      extras.set(key(ref), value);
    }
    return { issue, value };
  }
  async function result(ref: IssueRef): Promise<GitHubOperationResult> {
    return {
      repo: ref.repo,
      number: ref.number,
      issue: await service.get(ref),
    };
  }
  function touch(ref: IssueRef) {
    service.fixture.mutate(ref, () => undefined);
  }
  function ensureRepo(repo: string) {
    if (repo !== FIXTURE_REPO)
      invalid("The repository for this fixture is yu/Arco.");
  }
  async function comment(ref: IssueRef, commentId: number, expected?: string) {
    await service.get(ref);
    const issue = service.fixture
      .issues()
      .find((issue) => issue.repo === ref.repo && issue.number === ref.number);
    const value = issue?.comments.find(
      (candidate) => candidate.databaseId === commentId,
    );
    if (!value)
      return invalid(
        "This comment does not belong to the selected fixture issue.",
      );
    if (expected && expected !== value.updatedAt)
      throw new GitHubError(
        "This comment has changed. Keep your draft and refresh.",
        "conflict",
      );
    return value;
  }
  async function reactionKey(input: IssueRef & { commentId?: number }) {
    if (input.commentId !== undefined) await comment(input, input.commentId);
    else await service.get(input);
    return `${key(input)}:${input.commentId ?? "issue"}`;
  }
  async function membership(
    input: IssueRef & { projectId: string; itemId: string },
  ) {
    const { value } = await state(input);
    const selected = value.memberships.find(
      (item) =>
        item.projectId === input.projectId && item.itemId === input.itemId,
    );
    if (!selected)
      return invalid("The fixture issue, Project, and item do not match.");
    return selected;
  }
  async function related(ref: IssueRef): Promise<RelatedIssue> {
    const issue = await service.get(ref);
    return {
      repo: ref.repo,
      number: ref.number,
      id: ref.number,
      title: issue.title,
      state: issue.state,
      url: issue.url,
    };
  }
  const operations: ReturnType<typeof createGitHubOperations> = {
    async labelDefinitions(input) {
      ensureRepo(input.repo);
      return { repo: input.repo, labels: service.fixture.labels() };
    },
    createLabel(input) {
      return once(input.requestId, ["createLabel", input], async () => {
        ensureRepo(input.repo);
        const labels = service.fixture.labels();
        if (
          labels.some(
            (label) => label.name.toLowerCase() === input.name.toLowerCase(),
          )
        )
          return invalid("A label with this name already exists.");
        const label: LabelDefinition = {
          id: `fixture-label-${++labelSequence}`,
          name: input.name,
          color: input.color,
          description: input.description,
        };
        service.fixture.replaceLabels([...labels, label]);
        return { repo: input.repo, label };
      });
    },
    updateLabel(input) {
      return once(input.requestId, ["updateLabel", input], async () => {
        ensureRepo(input.repo);
        const labels = service.fixture.labels();
        const label = labels.find((candidate) => candidate.name === input.name);
        if (!label || !Object.keys(input.patch).length)
          return invalid("Select an existing label to change.");
        if (
          input.patch.name &&
          labels.some(
            (candidate) =>
              candidate.id !== label.id &&
              candidate.name.toLowerCase() === input.patch.name?.toLowerCase(),
          )
        )
          return invalid("A label with this name already exists.");
        Object.assign(label, input.patch);
        service.fixture.replaceLabels(labels);
        return { repo: input.repo, label };
      });
    },
    deleteLabel(input) {
      return once(input.requestId, ["deleteLabel", input], async () => {
        ensureRepo(input.repo);
        const labels = service.fixture.labels();
        if (!labels.some((label) => label.name === input.name))
          return invalid("Select an existing label.");
        service.fixture.replaceLabels(
          labels.filter((label) => label.name !== input.name),
        );
        return { repo: input.repo, deleted: true };
      });
    },
    editComment(input) {
      return once(input.requestId, ["editComment", input], async () => {
        await comment(input, input.commentId, input.expectedUpdatedAt);
        service.fixture.mutate(input, (issue) => {
          const selected = issue.comments.find(
            (candidate) => candidate.databaseId === input.commentId,
          );
          if (selected) {
            selected.body = input.body;
            selected.updatedAt = new Date().toISOString();
          }
        });
        return {
          ...(await result(input)),
          changedComment: await comment(input, input.commentId),
        };
      });
    },
    deleteComment(input) {
      return once(input.requestId, ["deleteComment", input], async () => {
        await comment(input, input.commentId, input.expectedUpdatedAt);
        service.fixture.mutate(input, (issue) => {
          issue.comments = issue.comments.filter(
            (candidate) => candidate.databaseId !== input.commentId,
          );
        });
        return { ...(await result(input)), deleted: true };
      });
    },
    async reactions(input) {
      const target = await reactionKey(input);
      return {
        repo: input.repo,
        number: input.number,
        ...(input.commentId !== undefined
          ? { commentId: input.commentId }
          : {}),
        reactions: structuredClone(reactionTargets.get(target) ?? []),
        account: "fixture-user",
      };
    },
    addReaction(input) {
      return once(input.requestId, ["addReaction", input], async () => {
        const target = await reactionKey(input);
        const values = reactionTargets.get(target) ?? [];
        if (
          !values.some(
            (value) =>
              value.content === input.content &&
              value.author === "fixture-user",
          )
        )
          values.push({
            id: reactionSequence++,
            content: input.content,
            author: "fixture-user",
          });
        reactionTargets.set(target, values);
        return result(input);
      });
    },
    removeReaction(input) {
      return once(input.requestId, ["removeReaction", input], async () => {
        const target = await reactionKey(input);
        const values = reactionTargets.get(target) ?? [];
        if (
          !values.some(
            (value) =>
              value.id === input.reactionId && value.author === "fixture-user",
          )
        )
          return invalid("Select your own reaction on this target.");
        reactionTargets.set(
          target,
          values.filter((value) => value.id !== input.reactionId),
        );
        return result(input);
      });
    },
    async issueCatalog(input) {
      const { value } = await state(input);
      return {
        repo: input.repo,
        number: input.number,
        milestoneNumber: value.milestoneNumber,
        issueTypeId: value.issueTypeId,
        milestones: structuredClone(milestones),
        issueTypes: structuredClone(issueTypes),
        errors: [],
      };
    },
    issueAttributes(input) {
      return once(input.requestId, ["issueAttributes", input], async () => {
        const { issue, value } = await state(input);
        if (
          input.expectedUpdatedAt &&
          input.expectedUpdatedAt !== issue.updatedAt
        )
          throw new GitHubError(
            "This issue has changed. Refresh before saving.",
            "conflict",
          );
        if (!Object.keys(input.patch).length)
          return invalid("Select the attributes to change.");
        if (
          input.patch.milestoneNumber != null &&
          !milestones.some(
            (item) => item.number === input.patch.milestoneNumber,
          )
        )
          return invalid("Select an existing milestone.");
        if (
          input.patch.issueTypeId != null &&
          !issueTypes.some((item) => item.id === input.patch.issueTypeId)
        )
          return invalid("Select an existing issue type.");
        if (input.patch.milestoneNumber !== undefined)
          value.milestoneNumber = input.patch.milestoneNumber;
        if (input.patch.issueTypeId !== undefined) {
          value.issueTypeId = input.patch.issueTypeId;
          const type = issueTypes.find(
            (type) => type.id === input.patch.issueTypeId,
          );
          service.fixture.mutate(input, (issue) => {
            issue.issueType = type
              ? { id: type.id, name: type.name, color: type.color }
              : null;
          });
        }
        touch(input);
        return result(input);
      });
    },
    async issueFields(input): Promise<IssueFieldList> {
      const { value } = await state(input);
      return {
        repo: input.repo,
        number: input.number,
        organization: "fixture-org",
        fields: issueDefinitions.map((field) => ({
          ...structuredClone(field),
          value: structuredClone(value.fields.get(field.id) ?? field.value),
        })),
      };
    },
    setIssueField(input) {
      return once(input.requestId, ["setIssueField", input], async () => {
        const { value } = await state(input);
        const field = issueDefinitions.find(
          (item) => item.id === input.fieldId,
        );
        if (!field?.supported)
          return invalid("Select an existing supported Issue field.");
        checkFieldValue(
          field.type,
          input.value,
          field.options.map((option) => option.name),
        );
        if (input.value === null) value.fields.delete(field.id);
        else value.fields.set(field.id, structuredClone(input.value));
        touch(input);
        return result(input);
      });
    },
    async projects(input) {
      ensureRepo(input.repo);
      return {
        repo: input.repo,
        owner: input.owner ?? "yu",
        ownerType: input.ownerType,
        projects: structuredClone(projectChoices),
        hasMore: false,
        cursor: null,
      };
    },
    async issueProjects(input): Promise<IssueProjectMemberships> {
      const { value } = await state(input);
      return {
        repo: input.repo,
        number: input.number,
        memberships: value.memberships.map(
          ({ projectId, itemId, title, url }) => ({
            projectId,
            itemId,
            title,
            url,
          }),
        ),
        errors: [],
      };
    },
    projectMembership(input) {
      return once(input.requestId, ["projectMembership", input], async () => {
        const { value } = await state(input);
        const choice = projectChoices.find(
          (project) => project.id === input.projectId,
        );
        if (!choice) return invalid("Select an existing Project.");
        if (input.action === "remove") {
          await membership({ ...input, itemId: input.itemId ?? "" });
          value.memberships = value.memberships.filter(
            (item) => item.projectId !== input.projectId,
          );
          service.fixture.mutate(input, (issue) => {
            issue.projects = issue.projects.filter(
              (item) => item.projectId !== input.projectId,
            );
          });
          return result(input);
        }
        let selected = value.memberships.find(
          (item) => item.projectId === input.projectId,
        );
        if (!selected) {
          selected = {
            projectId: input.projectId,
            itemId: `${input.projectId}-item-${input.number}`,
            title: choice.title,
            url: choice.url,
            values: new Map(),
          };
          value.memberships.push(selected);
          const status = projectDefinitions(choice.id).find(
            (field) => field.id === "fixture-status-field",
          );
          const itemId = selected.itemId;
          if (status)
            service.fixture.mutate(input, (issue) => {
              issue.projects.push({
                projectId: choice.id,
                projectTitle: choice.title,
                itemId,
                fieldId: status.id,
                fieldName: status.name,
                optionId: null,
                options: status.options,
              });
            });
        }
        return { ...(await result(input)), projectItemId: selected.itemId };
      });
    },
    async projectFields(input): Promise<ProjectFieldList> {
      const selected = await membership(input);
      const current = await service.get(input);
      const fields = projectDefinitions(input.projectId).map((field) => ({
        ...field,
        value:
          field.id === "fixture-status-field"
            ? (current.projects.find(
                (item) => item.projectId === input.projectId,
              )?.optionId ?? null)
            : (selected.values.get(field.id) ?? null),
      }));
      return {
        repo: input.repo,
        number: input.number,
        projectId: input.projectId,
        itemId: input.itemId,
        fields,
        hasMore: false,
      };
    },
    setProjectField(input) {
      return once(input.requestId, ["setProjectField", input], async () => {
        const selected = await membership(input);
        const field = projectDefinitions(input.projectId).find(
          (item) => item.id === input.fieldId,
        );
        if (!field?.supported)
          return invalid("Select an existing supported field in this Project.");
        checkFieldValue(
          field.type,
          input.value,
          field.options.map((option) => option.id),
          field.iterations.map((iteration) => iteration.id),
        );
        selected.values.set(field.id, structuredClone(input.value));
        service.fixture.mutate(input, (issue) => {
          if (field.id === "fixture-status-field") {
            const status = issue.projects.find(
              (item) =>
                item.projectId === input.projectId &&
                item.itemId === input.itemId,
            );
            if (status)
              status.optionId =
                typeof input.value === "string" ? input.value : null;
          }
        });
        return result(input);
      });
    },
    async issueRelations(input): Promise<IssueRelations> {
      const { value } = await state(input);
      const children: RelatedIssue[] = [];
      const blocking: RelatedIssue[] = [];
      for (const issue of service.fixture.issues()) {
        const stateValue = (await state(issue)).value;
        if (stateValue.parent && key(stateValue.parent) === key(input))
          children.push(await related(issue));
        if (stateValue.blockedBy.some((blocker) => key(blocker) === key(input)))
          blocking.push(await related(issue));
      }
      return {
        repo: input.repo,
        number: input.number,
        parent: value.parent ? await related(value.parent) : null,
        children,
        blockedBy: await Promise.all(value.blockedBy.map(related)),
        blocking,
        errors: [],
      };
    },
    setParent(input) {
      return once(input.requestId, ["setParent", input], async () => {
        const { value } = await state(input);
        await state(input.parent);
        if (key(input) === key(input.parent))
          return invalid("An issue cannot be its own parent.");
        if (
          value.parent &&
          key(value.parent) !== key(input.parent) &&
          !input.replace
        )
          return invalid(
            "This issue already has another parent. Explicitly choose to replace it.",
          );
        let ancestor: IssueRef | null = input.parent;
        while (ancestor) {
          if (key(ancestor) === key(input))
            return invalid(
              "Parent and child relationships cannot form a cycle.",
            );
          ancestor = (await state(ancestor)).value.parent;
        }
        value.parent = { repo: input.parent.repo, number: input.parent.number };
        touch(input);
        return result(input);
      });
    },
    removeParent(input) {
      return once(input.requestId, ["removeParent", input], async () => {
        const { value } = await state(input);
        if (!value.parent || key(value.parent) !== key(input.parent))
          return invalid("Select the current parent issue.");
        value.parent = null;
        touch(input);
        return result(input);
      });
    },
    createSubIssue(input) {
      return once(input.requestId, ["createSubIssue", input], async () => {
        await state(input);
        const child = await service.create({
          repo: input.childRepo,
          requestId: `${createHash("sha256").update(input.requestId).digest("hex").slice(0, 40)}-child`,
          title: input.title,
          body: input.body,
        });
        (await state(child)).value.parent = {
          repo: input.repo,
          number: input.number,
        };
        touch(input);
        return { ...(await result(input)), createdIssue: child };
      });
    },
    addDependency(input) {
      return once(input.requestId, ["addDependency", input], async () => {
        const { value } = await state(input);
        await state(input.blockedBy);
        if (key(input) === key(input.blockedBy))
          return invalid("An issue cannot depend on itself.");
        const pending = [input.blockedBy];
        const seen = new Set<string>();
        while (pending.length) {
          const candidate = pending.pop();
          if (!candidate) continue;
          if (key(candidate) === key(input))
            return invalid("Dependencies cannot form a cycle.");
          if (seen.has(key(candidate))) continue;
          seen.add(key(candidate));
          pending.push(...(await state(candidate)).value.blockedBy);
        }
        if (!value.blockedBy.some((item) => key(item) === key(input.blockedBy)))
          value.blockedBy.push({ ...input.blockedBy });
        touch(input);
        return result(input);
      });
    },
    removeDependency(input) {
      return once(input.requestId, ["removeDependency", input], async () => {
        const { value } = await state(input);
        if (!value.blockedBy.some((item) => key(item) === key(input.blockedBy)))
          return invalid("Select an existing blocked-by relationship.");
        value.blockedBy = value.blockedBy.filter(
          (item) => key(item) !== key(input.blockedBy),
        );
        touch(input);
        return result(input);
      });
    },
    async issueTemplates(input) {
      ensureRepo(input.repo);
      const url = `https://github.com/${input.repo}/issues/new/choose`;
      const templates: IssueTemplate[] = [
        {
          path: ".github/ISSUE_TEMPLATE/bug.md",
          name: "Bug report",
          description: "A simple Markdown template with existing defaults",
          kind: "simple",
          url,
          body: "## Steps to reproduce\n\n1. \n\n## Expected behavior\n\n",
          defaults: {
            title: "[Bug] ",
            type: "Bug",
            labels: service.fixture
              .labels()
              .some((label) => label.name === "bug")
              ? ["bug"]
              : [],
            assignees: [],
          },
        },
        {
          path: ".github/ISSUE_TEMPLATE/feature.yml",
          name: "Feature request form",
          description: "Required form fields",
          kind: "unsupported",
          reason: "Use GitHub for form templates with required fields.",
          url,
        },
      ];
      return { repo: input.repo, templates };
    },
    bulkUpdate(input) {
      return once(input.requestId, ["bulkUpdate", input], async () => {
        if (
          input.issues.some((issue) => issue.repo !== FIXTURE_REPO) ||
          new Set(input.issues.map(key)).size !== input.issues.length
        )
          return invalid("Select distinct issues from the same repository.");
        if (
          !input.patch &&
          !input.labels &&
          !input.issueField &&
          !input.projectField
        )
          return invalid("Select what to change.");
        const results: BulkUpdateResult["results"] = [];
        const prefix = createHash("sha256")
          .update(input.requestId)
          .digest("hex")
          .slice(0, 40);
        for (const [index, ref] of input.issues.entries()) {
          let applied = false;
          try {
            const { milestoneNumber, issueTypeId, ...patch } =
              input.patch ?? {};
            if (Object.keys(patch).length) {
              await service.update({
                ...ref,
                requestId: `${prefix}-${index}-base`,
                patch,
              });
              applied = true;
            }
            if (milestoneNumber !== undefined || issueTypeId !== undefined) {
              await operations.issueAttributes({
                ...ref,
                requestId: `${prefix}-${index}-attrs`,
                patch: {
                  ...(milestoneNumber !== undefined ? { milestoneNumber } : {}),
                  ...(issueTypeId !== undefined ? { issueTypeId } : {}),
                },
              });
              applied = true;
            }
            if (input.labels) {
              await service.labels({
                ...ref,
                requestId: `${prefix}-${index}-labels`,
                ...input.labels,
              });
              applied = true;
            }
            if (input.issueField) {
              await operations.setIssueField({
                ...ref,
                requestId: `${prefix}-${index}-field`,
                ...input.issueField,
              });
              applied = true;
            }
            if (input.projectField) {
              const selected = (await state(ref)).value.memberships.find(
                (item) => item.projectId === input.projectField?.projectId,
              );
              if (!selected)
                return invalid("This issue is not in the selected Project.");
              await operations.setProjectField({
                ...ref,
                requestId: `${prefix}-${index}-project`,
                ...input.projectField,
                itemId: selected.itemId,
              });
              applied = true;
            }
            results.push({ ...ref, ok: true, issue: await service.get(ref) });
          } catch (error) {
            results.push({
              ...ref,
              ok: false,
              errorCode:
                error instanceof GitHubError ? error.code : "unavailable",
              needsConfirmation:
                applied ||
                (error instanceof GitHubError &&
                  ["refresh", "partial", "not-applied", "uncertain"].includes(
                    error.code,
                  )),
              error:
                error instanceof GitHubError
                  ? error.message
                  : "fixtureThe operation failed.",
            });
          }
        }
        return { results };
      });
    },
  };
  return operations;
}
