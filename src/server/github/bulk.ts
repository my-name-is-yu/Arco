import { type BulkUpdateResult } from "../../shared/github-operations";
import type { IssueDetail } from "../../shared/contracts";
import type { createFieldsOperations } from "./fields";
import {
  childRequestId,
  invalid,
  type GitHubOperationContext,
  type Input,
} from "./operations-context";
import type { createProjectsOperations } from "./projects";
import { GitHubError } from "./transport";
export function createBulkOperations(
  context: GitHubOperationContext,
  fields: ReturnType<typeof createFieldsOperations>,
  projects: ReturnType<typeof createProjectsOperations>,
) {
  const { service, once } = context;
  const { issueAttributes, setIssueField } = fields;
  const { issueProjects, setProjectField } = projects;
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
          let issue: IssueDetail | undefined;
          const { milestoneNumber, issueTypeId, ...patch } = input.patch ?? {};
          if (Object.keys(patch).length)
            issue = await service.update({
              ...ref,
              requestId: `${key}-issue`,
              patch,
            });
          if (milestoneNumber !== undefined || issueTypeId !== undefined) {
            const result = await issueAttributes({
              ...ref,
              requestId: `${key}-attrs`,
              patch: {
                ...(milestoneNumber !== undefined ? { milestoneNumber } : {}),
                ...(issueTypeId !== undefined ? { issueTypeId } : {}),
              },
            });
            issue = "issue" in result ? result.issue : undefined;
          }
          if (input.labels)
            issue = await service.labels({
              ...ref,
              requestId: `${key}-labels`,
              ...input.labels,
            });
          if (input.issueField) {
            const result = await setIssueField({
              ...ref,
              requestId: `${key}-field`,
              ...input.issueField,
            });
            issue = "issue" in result ? result.issue : undefined;
          }
          if (input.projectField) {
            const membership = (await issueProjects(ref)).memberships.find(
              (item) => item.projectId === input.projectField?.projectId,
            );
            if (!membership)
              return invalid("An issue is not in the selected Project.");
            const result = await setProjectField({
              ...ref,
              requestId: `${key}-project`,
              ...input.projectField,
              itemId: membership.itemId,
            });
            issue = "issue" in result ? result.issue : undefined;
          }
          results.push({
            ...ref,
            ok: true,
            issue: issue ?? (await service.get(ref)),
          });
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
  return { bulkUpdate };
}
