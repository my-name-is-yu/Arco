import type { GitHubService } from "../shared/contracts";
import {
  githubOperationSchemas,
  type GitHubOperationToolName,
} from "../shared/github-operations";
import { createBulkOperations } from "./github/bulk";
import { createCommentsOperations } from "./github/comments";
import { createFieldsOperations } from "./github/fields";
import { createLabelsOperations } from "./github/labels";
import { createGitHubOperationContext } from "./github/operations-context";
import { createProjectsOperations } from "./github/projects";
import { createRelationsOperations } from "./github/relations";
import { createTemplatesOperations } from "./github/templates";
import type { GhRunner } from "./github/transport";
import type { GitHubAuthSession } from "./github/auth-session";
export { checkFieldValue } from "./github/field-values";
export { classifyMarkdownTemplate } from "./github/templates";
export const githubOperationReadOnly = new Set<GitHubOperationToolName>([
  "arco_label_definitions",
  "arco_reactions",
  "arco_issue_catalog",
  "arco_issue_fields",
  "arco_projects",
  "arco_issue_projects",
  "arco_project_fields",
  "arco_issue_relations",
  "arco_issue_templates",
]);
export function createGitHubOperations(options: {
  service: GitHubService;
  run?: GhRunner;
  credentialIdentity?: () => Promise<string>;
  authSession?: GitHubAuthSession;
}) {
  const context = createGitHubOperationContext(options);
  const fields = createFieldsOperations(context);
  const projects = createProjectsOperations(context);
  return {
    ...createLabelsOperations(context),
    ...createCommentsOperations(context),
    ...createRelationsOperations(context),
    ...createTemplatesOperations(context),
    ...fields,
    ...projects,
    ...createBulkOperations(context, fields, projects),
  };
}
export async function callGitHubOperation(
  operations: ReturnType<typeof createGitHubOperations>,
  name: GitHubOperationToolName,
  args: unknown,
): Promise<object> {
  switch (name) {
    case "arco_label_definitions":
      return operations.labelDefinitions(
        githubOperationSchemas[name].parse(args),
      );
    case "arco_create_label":
      return operations.createLabel(githubOperationSchemas[name].parse(args));
    case "arco_update_label":
      return operations.updateLabel(githubOperationSchemas[name].parse(args));
    case "arco_delete_label":
      return operations.deleteLabel(githubOperationSchemas[name].parse(args));
    case "arco_edit_comment":
      return operations.editComment(githubOperationSchemas[name].parse(args));
    case "arco_delete_comment":
      return operations.deleteComment(githubOperationSchemas[name].parse(args));
    case "arco_reactions":
      return operations.reactions(githubOperationSchemas[name].parse(args));
    case "arco_add_reaction":
      return operations.addReaction(githubOperationSchemas[name].parse(args));
    case "arco_remove_reaction":
      return operations.removeReaction(
        githubOperationSchemas[name].parse(args),
      );
    case "arco_issue_catalog":
      return operations.issueCatalog(githubOperationSchemas[name].parse(args));
    case "arco_issue_attributes":
      return operations.issueAttributes(
        githubOperationSchemas[name].parse(args),
      );
    case "arco_issue_fields":
      return operations.issueFields(githubOperationSchemas[name].parse(args));
    case "arco_set_issue_field":
      return operations.setIssueField(githubOperationSchemas[name].parse(args));
    case "arco_projects":
      return operations.projects(githubOperationSchemas[name].parse(args));
    case "arco_issue_projects":
      return operations.issueProjects(githubOperationSchemas[name].parse(args));
    case "arco_project_membership":
      return operations.projectMembership(
        githubOperationSchemas[name].parse(args),
      );
    case "arco_project_fields":
      return operations.projectFields(githubOperationSchemas[name].parse(args));
    case "arco_set_project_field":
      return operations.setProjectField(
        githubOperationSchemas[name].parse(args),
      );
    case "arco_issue_relations":
      return operations.issueRelations(
        githubOperationSchemas[name].parse(args),
      );
    case "arco_set_parent":
      return operations.setParent(githubOperationSchemas[name].parse(args));
    case "arco_remove_parent":
      return operations.removeParent(githubOperationSchemas[name].parse(args));
    case "arco_create_sub_issue":
      return operations.createSubIssue(
        githubOperationSchemas[name].parse(args),
      );
    case "arco_add_dependency":
      return operations.addDependency(githubOperationSchemas[name].parse(args));
    case "arco_remove_dependency":
      return operations.removeDependency(
        githubOperationSchemas[name].parse(args),
      );
    case "arco_issue_templates":
      return operations.issueTemplates(
        githubOperationSchemas[name].parse(args),
      );
    case "arco_bulk_update":
      return operations.bulkUpdate(githubOperationSchemas[name].parse(args));
  }
}
