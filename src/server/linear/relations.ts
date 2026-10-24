import { IssueRelationType } from "@linear/sdk";

import {
  assertSuccess,
  type LinearHandlers,
  type LinearOperation,
} from "./operation";
export function createRelationsHandlers(operation: LinearOperation) {
  const { context, checkedIssue, refreshAfterWrite } = operation;

  const handlers = {
    linear_relation: async (input) => {
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
    },
  } satisfies Pick<LinearHandlers, "linear_relation">;
  return handlers;
}
