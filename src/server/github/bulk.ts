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
import { createGitHubWriteGuard, GitHubError } from "./transport";
import { getWriteProgress } from "../write-guard";
export function createBulkOperations(
  context: GitHubOperationContext,
  fields: ReturnType<typeof createFieldsOperations>,
  projects: ReturnType<typeof createProjectsOperations>,
) {
  const onceMember = createGitHubWriteGuard<
    BulkUpdateResult["results"][number]
  >(context.authSession.read);
  function bulkUpdate(input: Input<"arco_bulk_update">) {
    return context.once(input.requestId, ["bulkUpdate", input], async () => {
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
        results.push(
          await onceMember(
            `${key}-member`,
            ["bulkMember", input, ref],
            async () => {
              try {
                let issue: IssueDetail | undefined;
                const { milestoneNumber, issueTypeId, ...patch } =
                  input.patch ?? {};
                if (Object.keys(patch).length)
                  issue = await context.service.update({
                    ...ref,
                    requestId: `${key}-issue`,
                    patch,
                  });
                if (
                  milestoneNumber !== undefined ||
                  issueTypeId !== undefined
                ) {
                  const result = await fields.issueAttributes({
                    ...ref,
                    requestId: `${key}-attrs`,
                    patch: {
                      ...(milestoneNumber !== undefined
                        ? { milestoneNumber }
                        : {}),
                      ...(issueTypeId !== undefined ? { issueTypeId } : {}),
                    },
                  });
                  issue = "issue" in result ? result.issue : undefined;
                }
                if (input.labels)
                  issue = await context.service.labels({
                    ...ref,
                    requestId: `${key}-labels`,
                    ...input.labels,
                  });
                if (input.issueField) {
                  const result = await fields.setIssueField({
                    ...ref,
                    requestId: `${key}-field`,
                    ...input.issueField,
                  });
                  issue = "issue" in result ? result.issue : undefined;
                }
                if (input.projectField) {
                  const membership = (
                    await projects.issueProjects(ref)
                  ).memberships.find(
                    (item) => item.projectId === input.projectField?.projectId,
                  );
                  if (!membership)
                    return invalid("An issue is not in the selected Project.");
                  const result = await projects.setProjectField({
                    ...ref,
                    requestId: `${key}-project`,
                    ...input.projectField,
                    itemId: membership.itemId,
                  });
                  issue = "issue" in result ? result.issue : undefined;
                }
                return {
                  ...ref,
                  ok: true,
                  issue: issue ?? (await context.service.get(ref)),
                };
              } catch (error) {
                const progress = getWriteProgress();
                return {
                  ...ref,
                  ok: false,
                  errorCode:
                    error instanceof GitHubError ? error.code : "unavailable",
                  needsConfirmation:
                    progress.confirmed ||
                    progress.uncertain ||
                    (error instanceof GitHubError &&
                      [
                        "refresh",
                        "partial",
                        "not-applied",
                        "uncertain",
                      ].includes(error.code)),
                  error:
                    error instanceof GitHubError
                      ? error.message
                      : "This issue could not be updated. Some changes may have been applied; refresh to check the result.",
                };
              }
            },
          ),
        );
      }
      return { results };
    });
  }
  return { bulkUpdate };
}
