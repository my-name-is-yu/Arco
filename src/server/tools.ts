import { OpenAIMentionSearchParamsSchema } from "@openai/mcp-extensions";
import { z } from "zod";
import {
  accountIssuesInputSchema,
  commentInputSchema,
  commentsInputSchema,
  createInputSchema,
  issueRefSchema,
  labelInputSchema,
  listInputSchema,
  projectInputSchema,
  repoSchema,
  repositoriesInputSchema,
  updateInputSchema,
  type GitHubService,
} from "../shared/contracts";

export const dataSchemas = {
  arco_connection: z.object({}),
  arco_list_issues: listInputSchema,
  arco_account_issues: accountIssuesInputSchema,
  arco_repositories: repositoriesInputSchema,
  arco_get_issue: issueRefSchema,
  arco_comments: commentsInputSchema,
  arco_repo_metadata: z.object({ repo: repoSchema }),
  arco_update_issue: updateInputSchema,
  arco_change_labels: labelInputSchema,
  arco_comment: commentInputSchema,
  arco_create_issue: createInputSchema,
  arco_project_status: projectInputSchema,
  search_mentions: OpenAIMentionSearchParamsSchema,
};
export type DataToolName = keyof typeof dataSchemas;

export async function callDataTool(
  service: GitHubService,
  name: Exclude<DataToolName, "search_mentions">,
  args: unknown,
): Promise<object> {
  switch (name) {
    case "arco_connection":
      dataSchemas.arco_connection.parse(args);
      return service.connection();
    case "arco_list_issues":
      return service.list(listInputSchema.parse(args));
    case "arco_account_issues":
      return service.accountIssues(accountIssuesInputSchema.parse(args));
    case "arco_repositories":
      return service.repositories(repositoriesInputSchema.parse(args));
    case "arco_get_issue":
      return service.get(issueRefSchema.parse(args));
    case "arco_comments":
      return service.comments(commentsInputSchema.parse(args));
    case "arco_repo_metadata":
      return service.metadata(dataSchemas.arco_repo_metadata.parse(args).repo);
    case "arco_update_issue":
      return service.update(updateInputSchema.parse(args));
    case "arco_change_labels":
      return service.labels(labelInputSchema.parse(args));
    case "arco_comment":
      return service.comment(commentInputSchema.parse(args));
    case "arco_create_issue":
      return service.create(createInputSchema.parse(args));
    case "arco_project_status":
      return service.projectStatus(projectInputSchema.parse(args));
  }
}
