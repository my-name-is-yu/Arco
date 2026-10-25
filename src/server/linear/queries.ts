import { LinearServiceError } from "./errors";
import { linearIssueUrl } from "../../shared/issue-url";
import { readIssueImage } from "../images";
import { createLinearIssueReader } from "./issue-list";

import { type LinearHandlers, type LinearOperation } from "./operation";
export function createQueriesHandlers(operation: LinearOperation) {
  return {
    linear_metadata: operation.metadata,
    linear_resolve_issue: async (input) => {
      const target = linearIssueUrl(input.url);
      const client = operation.makeClient(
        await operation.auth.accessToken(input.connectionId),
      );
      const organization = await client.organization;
      if (organization.urlKey.toLowerCase() !== target.workspace)
        throw new LinearServiceError(
          "This issue URL belongs to a different Linear workspace. Use its authorized connection.",
        );
      const issue = await client.issue(target.identifier);
      const canonical = linearIssueUrl(issue.url);
      if (
        canonical.workspace !== target.workspace ||
        canonical.identifier !== target.identifier ||
        issue.identifier.toUpperCase() !== target.identifier
      )
        throw new LinearServiceError(
          "Linear returned a different issue than the pasted URL.",
        );
      const team = await issue.team;
      if (
        !team ||
        team.id !== issue.teamId ||
        (await team.organization).id !== organization.id
      )
        throw new LinearServiceError(
          "The resolved issue team does not belong to this Linear workspace.",
        );
      return {
        connectionId: input.connectionId,
        workspaceId: organization.id,
        teamId: team.id,
        issueId: issue.id,
      };
    },
    linear_get_issue: operation.detail,
    linear_comments: async (input) => {
      const { client } = await operation.context(input);
      return operation.commentsPage(
        await operation.checkedIssue(client, input),
        input.cursor,
      );
    },
    linear_read_image: async (input) => {
      const { client } = await operation.context(input);
      const issue = await operation.checkedIssue(client, input);
      const comment = input.commentId
        ? await client.comment({ id: input.commentId })
        : null;
      if (
        comment &&
        (comment.id !== input.commentId ||
          (await comment.issue)?.id !== issue.id)
      )
        throw new LinearServiceError(
          "The image comment does not belong to this issue.",
        );
      const markdown = comment ? comment.body : (issue.description ?? "");
      return readIssueImage(
        {
          url: input.url,
          markdown,
          authorization: {
            hostname: "uploads.linear.app",
            value: `Bearer ${await operation.auth.accessToken(input.connectionId)}`,
          },
        },
        { fetch: operation.request },
      );
    },
    linear_templates: operation.templates,
    linear_list_issues: createLinearIssueReader(operation),
  } satisfies Pick<
    LinearHandlers,
    | "linear_metadata"
    | "linear_resolve_issue"
    | "linear_get_issue"
    | "linear_comments"
    | "linear_read_image"
    | "linear_templates"
    | "linear_list_issues"
  >;
}
