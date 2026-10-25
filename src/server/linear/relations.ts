import { LinearServiceError } from "./errors";
import { IssueRelationType } from "@linear/sdk";

import {
  linearMutation,
  type LinearHandlers,
  type LinearOperation,
} from "./operation";
export function createRelationsHandlers(operation: LinearOperation) {
  return {
    linear_relation: async (input) => {
      const { client } = await operation.context(input);
      const issue = await operation.checkedIssue(client, input);
      if (input.action === "add") {
        if (!input.relatedIssueId)
          throw new LinearServiceError("Choose a related issue.");
        const other = await client.issue(input.relatedIssueId);
        if (
          other.id === issue.id ||
          (await (await other.team)?.organization)?.id !== input.workspaceId
        )
          throw new LinearServiceError(
            "Choose a different issue in the same workspace.",
          );
        await linearMutation(() =>
          client.createIssueRelation({
            issueId: input.kind === "blocked-by" ? other.id : issue.id,
            relatedIssueId: input.kind === "blocked-by" ? issue.id : other.id,
            type:
              input.kind === "related"
                ? IssueRelationType.Related
                : IssueRelationType.Blocks,
          }),
        );
      }
      if (input.action === "remove") {
        if (!input.relationId)
          throw new LinearServiceError("Choose a relation to remove.");
        const relation = await client.issueRelation(input.relationId);
        if (
          (relation.issueId !== issue.id &&
            relation.relatedIssueId !== issue.id) ||
          !["blocks", "related"].includes(relation.type)
        )
          throw new LinearServiceError(
            "Only supported relations on this issue can be removed.",
          );
        await linearMutation(() => client.deleteIssueRelation(relation.id));
      }
      return operation.refreshAfterWrite(input, undefined, {
        operation: "relation",
      });
    },
  } satisfies Pick<LinearHandlers, "linear_relation">;
}
