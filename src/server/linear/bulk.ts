import { LinearServiceError, linearFailure } from "./errors";
import type { createIssuesHandlers } from "./issues";
import {
  assertSuccess,
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
            await applyLabels({
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
              linearFailure(error, { write: true }).message
            }`,
          });
        }
      }
      return { results };
    },
  } satisfies Pick<LinearHandlers, "linear_bulk">;
  return handlers;
}
