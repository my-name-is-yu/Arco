import { PaginationOrderBy } from "@linear/sdk";
import { linearIssueUrl } from "../../shared/issue-url";
import { readIssueImage } from "../images";
import type { IssueFilter } from "./operation";

import { type LinearHandlers, type LinearOperation } from "./operation";
export function createQueriesHandlers(operation: LinearOperation) {
  const {
    auth,
    makeClient,
    request,
    context,
    checkedIssue,
    metadata,
    summary,
    commentsPage,
    detail,
    templates,
  } = operation;

  const handlers = {
    linear_metadata: async (input) => {
      return metadata(input);
    },
    linear_resolve_issue: async (input) => {
      const target = linearIssueUrl(input.url);
      const client = makeClient(await auth.accessToken(input.connectionId));
      const organization = await client.organization;
      if (organization.urlKey.toLowerCase() !== target.workspace)
        throw new Error(
          "This issue URL belongs to a different Linear workspace. Use its authorized connection.",
        );
      const issue = await client.issue(target.identifier);
      const canonical = linearIssueUrl(issue.url);
      if (
        canonical.workspace !== target.workspace ||
        canonical.identifier !== target.identifier ||
        issue.identifier.toUpperCase() !== target.identifier
      )
        throw new Error(
          "Linear returned a different issue than the pasted URL.",
        );
      const team = await issue.team;
      if (
        !team ||
        team.id !== issue.teamId ||
        (await team.organization).id !== organization.id
      )
        throw new Error(
          "The resolved issue team does not belong to this Linear workspace.",
        );
      return {
        connectionId: input.connectionId,
        workspaceId: organization.id,
        teamId: team.id,
        issueId: issue.id,
      };
    },
    linear_get_issue: async (input) => {
      return detail(input);
    },
    linear_comments: async (input) => {
      const { client } = await context(input);
      return commentsPage(await checkedIssue(client, input), input.cursor);
    },
    linear_read_image: async (input) => {
      const { client } = await context(input);
      const issue = await checkedIssue(client, input);
      const comment = input.commentId
        ? await client.comment({ id: input.commentId })
        : null;
      if (
        comment &&
        (comment.id !== input.commentId ||
          (await comment.issue)?.id !== issue.id)
      )
        throw new Error("The image comment does not belong to this issue.");
      const markdown = comment ? comment.body : (issue.description ?? "");
      return readIssueImage(
        {
          url: input.url,
          markdown,
          authorization: {
            hostname: "uploads.linear.app",
            value: `Bearer ${await auth.accessToken(input.connectionId)}`,
          },
        },
        { fetch: request },
      );
    },
    linear_templates: async (input) => {
      return templates(input);
    },
    linear_list_issues: async (input) => {
      const { client } = await context(input);
      const meta = await metadata(input);
      const filter: IssueFilter = {
        team: { id: { eq: input.teamId } },
        ...(input.stateId ? { state: { id: { eq: input.stateId } } } : {}),
        ...(input.assigneeId
          ? { assignee: { id: { eq: input.assigneeId } } }
          : {}),
        ...(input.labelId
          ? { labels: { some: { id: { eq: input.labelId } } } }
          : {}),
        ...(input.projectId
          ? { project: { id: { eq: input.projectId } } }
          : {}),
      };
      const parameters = {
        filter,
        first: 30,
        after: input.cursor,
        orderBy:
          input.order === "createdAt"
            ? PaginationOrderBy.CreatedAt
            : PaginationOrderBy.UpdatedAt,
      };
      const page = input.query.trim()
        ? await client.searchIssues(input.query, {
            ...parameters,
            teamId: input.teamId,
            includeComments: true,
          })
        : await client.issues(parameters);
      return {
        issues: await Promise.all(
          page.nodes.map((issue) => summary(input, issue, meta)),
        ),
        hasMore: page.pageInfo.hasNextPage,
        cursor: page.pageInfo.endCursor ?? null,
      };
    },
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
  return handlers;
}
