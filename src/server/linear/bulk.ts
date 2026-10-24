import { LinearServiceError, linearFailure } from "./errors";
import type { createIssuesHandlers } from "./issues";
import type { LinearBulkMemberResult } from "../../shared/linear";
import {
  linearMutation,
  type LinearHandlers,
  type LinearOperation,
} from "./operation";
export function createBulkHandlers(
  operation: LinearOperation,
  changes: ReturnType<typeof createIssuesHandlers>,
) {
  const { context, checkedIssue, detail } = operation;
  const { validatePatch, applyLabels } = changes;

  const handlers = {
    linear_bulk: async (input) => {
      await context(input);
      if (
        !input.patch &&
        !input.addLabels?.length &&
        !input.removeLabels?.length
      )
        throw new LinearServiceError(
          "Choose a property or label for the bulk change.",
        );
      const results: LinearBulkMemberResult[] = [];
      for (const issueId of [...new Set(input.issueIds)]) {
        let saved = false;
        try {
          const ref = { ...input, issueId };
          const { client } = await context(ref);
          const issue = await checkedIssue(client, ref);
          if (input.patch) {
            const patch = await validatePatch(ref, issue, input.patch);
            await linearMutation(() => client.updateIssue(issue.id, patch));
            saved = true;
          }
          if (input.addLabels?.length || input.removeLabels?.length) {
            await applyLabels({
              ...ref,
              requestId: `${input.requestId}:${issueId}`,
              add: input.addLabels ?? [],
              remove: input.removeLabels ?? [],
            });
            saved = true;
          }
          try {
            results.push({
              issueId,
              success: true,
              saved,
              retryable: false,
              issue: await detail(ref),
            });
          } catch {
            results.push({
              issueId,
              success: true,
              saved,
              retryable: false,
              refreshError:
                "The changes were saved, but the issue could not be refreshed. Refresh its details before another change.",
            });
          }
        } catch (error) {
          const failure = linearFailure(error);
          const issue = await detail({ ...input, issueId }).catch(
            () => undefined,
          );
          results.push({
            issueId,
            success: false,
            saved,
            retryable: !saved && failure.code !== "uncertain",
            ...(issue ? { issue } : {}),
            error: `${saved ? "Properties were saved, but a later change failed. " : "Refresh and check the current state. "}${
              failure.message
            }`,
          });
        }
      }
      return { results };
    },
  } satisfies Pick<LinearHandlers, "linear_bulk">;
  return handlers;
}
