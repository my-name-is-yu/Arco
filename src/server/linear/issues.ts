import { LinearServiceError } from "./errors";
import { type Issue } from "@linear/sdk";
import { type LinearRef } from "../../shared/linear";
import type { IssueUpdateInput } from "./operation";

import {
  assertSuccess,
  type Args,
  type LinearHandlers,
  type LinearOperation,
} from "./operation";
export function createIssuesHandlers(operation: LinearOperation) {
  const { context, checkedIssue, metadata, refreshAfterWrite, templates } =
    operation;

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
        throw new LinearServiceError(
          `${field} does not match an existing value in the selected team.`,
        );
    };
    includes(meta.states, patch.stateId, "workflow state");
    if (
      meta.states.some(
        (state) => state.id === patch.stateId && state.type === "duplicate",
      )
    )
      throw new LinearServiceError(
        "Merge duplicate issues in Linear. Changing the state alone cannot perform a merge.",
        "unsupported",
      );
    includes(meta.members, patch.assigneeId, "Assignee");
    includes(meta.projects, patch.projectId, "Project");
    includes(meta.cycles, patch.cycleId, "cycle");
    if (patch.estimate != null && !meta.estimateValues.includes(patch.estimate))
      throw new LinearServiceError(
        "This value is not in the team's estimate scale.",
      );
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
      throw new LinearServiceError(
        "The project milestone does not match the target project.",
      );
    if (patch.parentId) {
      const { client } = await context(scope);
      const parent = await client.issue(patch.parentId);
      if (
        parent.id === current.id ||
        (await (await parent.team)?.organization)?.id !== scope.workspaceId
      )
        throw new LinearServiceError(
          "The parent issue is in another workspace or refers to this issue itself.",
        );
    }
    const { body, ...attributes } = patch;
    return {
      ...attributes,
      ...(body === undefined ? {} : { description: body }),
    };
  }
  async function applyLabels(input: Args<"linear_change_labels">) {
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
      throw new LinearServiceError(
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
            throw new LinearServiceError(
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
    return current.id;
  }
  async function changeLabels(input: Args<"linear_change_labels">) {
    const issueId = await applyLabels(input);
    return refreshAfterWrite({ ...input, issueId });
  }
  const handlers = {
    linear_create_issue: async (input) => {
      const { client } = await context(input);
      if (
        input.templateId &&
        !(await templates(input)).templates.some(
          (value) => value.id === input.templateId && value.supported,
        )
      )
        throw new LinearServiceError(
          "Create an issue from this template in Linear so every field is preserved.",
          "unsupported",
        );
      if (input.parentId) {
        const parent = await client.issue(input.parentId);
        if ((await (await parent.team)?.organization)?.id !== input.workspaceId)
          throw new LinearServiceError(
            "The parent issue belongs to another workspace.",
          );
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
        throw new LinearServiceError(
          "The created Linear issue ID could not be loaded. Check Linear before creating another issue.",
          "uncertain",
        );
      return refreshAfterWrite(
        { ...input, issueId: created.issueId },
        `Linear issue ${created.issueId} was created. Do not create it again.`,
        { operation: "create_issue" },
      );
    },
    linear_update_issue: async (input) => {
      const { client } = await context(input);
      const current = await checkedIssue(client, input);
      if (current.updatedAt.toISOString() !== input.expectedUpdatedAt)
        throw new LinearServiceError(
          "This Linear issue changed elsewhere. Keep your draft and refresh.",
          "conflict",
        );
      assertSuccess(
        await client.updateIssue(
          current.id,
          await validatePatch(input, current, input.patch),
        ),
      );
      return refreshAfterWrite({ ...input, issueId: current.id });
    },
    linear_change_labels: async (input) => {
      return changeLabels(input);
    },
    linear_label_definition: async (input) => {
      const { client } = await context(input);
      if (input.action === "create") {
        if (!input.name) throw new LinearServiceError("Enter a label name.");
        assertSuccess(
          await client.createIssueLabel({
            name: input.name,
            color: input.color,
            description: input.description,
            ...(input.scope === "team" ? { teamId: input.teamId } : {}),
          }),
        );
      } else {
        if (!input.labelId)
          throw new LinearServiceError("Choose a target label.");
        const current = await client.issueLabel(input.labelId);
        if (
          (current.teamId ?? null) !==
          (input.scope === "team" ? input.teamId : null)
        )
          throw new LinearServiceError(
            "The original label scope does not match. Move label scopes in Linear.",
          );
        if (current.isGroup)
          throw new LinearServiceError(
            "Manage label groups in Linear.",
            "unsupported",
          );
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
      try {
        return await metadata(input);
      } catch {
        throw new LinearServiceError(
          "The Linear label change was saved, but its choices could not be refreshed. Check Linear and refresh before another change.",
          "uncertain",
        );
      }
    },
  } satisfies Pick<
    LinearHandlers,
    | "linear_create_issue"
    | "linear_update_issue"
    | "linear_change_labels"
    | "linear_label_definition"
  >;
  return { handlers, validatePatch, applyLabels };
}
