import { LinearServiceError, linearFailure } from "./errors";
import type { createIssuesHandlers } from "./issues";
import type { LinearBulkMemberResult } from "../../shared/linear";
import { createWriteGuard, getWriteProgress } from "../write-guard";
import {
  linearMutation,
  type LinearHandlers,
  type LinearOperation,
} from "./operation";
export function createBulkHandlers(
  operation: LinearOperation,
  changes: ReturnType<typeof createIssuesHandlers>,
) {
  const onceMember = createWriteGuard<LinearBulkMemberResult>();
  return {
    linear_bulk: async (input) => {
      await operation.context(input);
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
        results.push(
          await onceMember(
            JSON.stringify([input.requestId, issueId]),
            input,
            async () => {
              let saved = false;
              try {
                const ref = { ...input, issueId };
                if (input.patch) {
                  const { client } = await operation.context(ref);
                  const issue = await operation.checkedIssue(client, ref);
                  const patch = await changes.validatePatch(
                    ref,
                    issue,
                    input.patch,
                  );
                  await linearMutation(() =>
                    client.updateIssue(issue.id, patch),
                  );
                  saved = true;
                }
                if (input.addLabels?.length || input.removeLabels?.length) {
                  await changes.applyLabels({
                    ...ref,
                    requestId: `${input.requestId}:${issueId}`,
                    add: input.addLabels ?? [],
                    remove: input.removeLabels ?? [],
                  });
                  saved = true;
                }
                try {
                  return {
                    issueId,
                    success: true,
                    saved,
                    retryable: false,
                    issue: await operation.detail(ref),
                  };
                } catch {
                  return {
                    issueId,
                    success: true,
                    saved,
                    retryable: false,
                    refreshError:
                      "The changes were saved, but the issue could not be refreshed. Refresh its details before another change.",
                  };
                }
              } catch (error) {
                const progress = getWriteProgress();
                saved ||= progress.confirmed;
                const failure = linearFailure(error);
                const issue = await operation
                  .detail({ ...input, issueId })
                  .catch(() => undefined);
                return {
                  issueId,
                  success: false,
                  saved,
                  retryable:
                    !saved &&
                    !progress.uncertain &&
                    failure.code !== "uncertain",
                  ...(issue ? { issue } : {}),
                  error: `${saved ? `${input.patch ? "Properties" : "Labels"} were saved, but a later change failed. ` : "Refresh and check the current state. "}${
                    failure.message
                  }`,
                };
              }
            },
          ),
        );
      }
      return { results };
    },
  } satisfies Pick<LinearHandlers, "linear_bulk">;
}
