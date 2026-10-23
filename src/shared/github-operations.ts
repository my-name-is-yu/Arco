import { z } from "zod";
import {
  issueRefSchema,
  repoSchema,
  type IssueDetail,
  type Comment,
  type IssueRef,
  type Label,
} from "./contracts";

const requestId = z.string().min(8).max(100);
const id = z.string().min(1).max(200);
const databaseId = z.number().int().positive();
const writeRef = issueRefSchema.extend({ requestId });
const repoInput = z.object({ repo: repoSchema });
const labelName = z.string().min(1).max(100);
const labelColor = z.string().regex(/^[a-fA-F0-9]{6}$/);
export const reactionContentSchema = z.enum([
  "+1",
  "-1",
  "laugh",
  "confused",
  "heart",
  "hooray",
  "rocket",
  "eyes",
]);
export const fieldValueSchema = z.union([
  z.string().max(65536),
  z.number().finite(),
  z.array(z.string().max(200)).max(100),
  z.null(),
]);
export type FieldValue = z.infer<typeof fieldValueSchema>;
const issueFieldChange = z.object({
  fieldId: databaseId,
  value: fieldValueSchema,
});
const projectFieldChange = z.object({
  projectId: id,
  fieldId: id,
  value: fieldValueSchema,
});

/** Each tool is a bounded source operation; field definitions and Project administration are excluded. */
export const githubOperationSchemas = {
  arco_label_definitions: repoInput,
  arco_create_label: repoInput.extend({
    requestId,
    name: labelName,
    color: labelColor,
    description: z.string().max(100).default(""),
  }),
  arco_update_label: repoInput.extend({
    requestId,
    name: labelName,
    patch: z
      .object({
        name: labelName.optional(),
        color: labelColor.optional(),
        description: z.string().max(100).optional(),
      })
      .strict(),
  }),
  arco_delete_label: repoInput.extend({ requestId, name: labelName }),
  arco_edit_comment: writeRef.extend({
    commentId: databaseId,
    body: z.string().min(1).max(65536),
    expectedUpdatedAt: z.string().optional(),
  }),
  arco_delete_comment: writeRef.extend({
    commentId: databaseId,
    expectedUpdatedAt: z.string().optional(),
  }),
  arco_reactions: issueRefSchema.extend({ commentId: databaseId.optional() }),
  arco_add_reaction: writeRef.extend({
    commentId: databaseId.optional(),
    content: reactionContentSchema,
  }),
  arco_remove_reaction: writeRef.extend({
    commentId: databaseId.optional(),
    reactionId: databaseId,
  }),
  arco_issue_catalog: issueRefSchema,
  arco_issue_attributes: writeRef.extend({
    expectedUpdatedAt: z.string().optional(),
    patch: z
      .object({
        milestoneNumber: databaseId.nullable().optional(),
        issueTypeId: databaseId.nullable().optional(),
      })
      .strict(),
  }),
  arco_issue_fields: issueRefSchema,
  arco_set_issue_field: writeRef.extend(issueFieldChange.shape),
  arco_projects: repoInput.extend({
    owner: z
      .string()
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
    ownerType: z.enum(["user", "organization"]).default("user"),
    cursor: z.string().optional(),
  }),
  arco_issue_projects: issueRefSchema,
  arco_project_membership: writeRef.extend({
    projectId: id,
    action: z.enum(["add", "remove"]),
    itemId: id.optional(),
  }),
  arco_project_fields: issueRefSchema.extend({ projectId: id, itemId: id }),
  arco_set_project_field: writeRef.extend({
    ...projectFieldChange.shape,
    itemId: id,
  }),
  arco_issue_relations: issueRefSchema,
  arco_set_parent: writeRef.extend({
    parent: issueRefSchema,
    replace: z.boolean().default(false),
  }),
  arco_remove_parent: writeRef.extend({ parent: issueRefSchema }),
  arco_create_sub_issue: writeRef.extend({
    childRepo: repoSchema,
    title: z.string().min(1).max(256),
    body: z.string().max(65536),
  }),
  arco_add_dependency: writeRef.extend({ blockedBy: issueRefSchema }),
  arco_remove_dependency: writeRef.extend({ blockedBy: issueRefSchema }),
  arco_issue_templates: repoInput,
  arco_bulk_update: z.object({
    issues: z.array(issueRefSchema).min(1).max(100),
    requestId,
    patch: z
      .object({
        state: z.enum(["open", "closed"]).optional(),
        stateReason: z
          .enum(["completed", "not_planned", "reopened"])
          .optional(),
        assignees: z.array(z.string().min(1).max(100)).max(100).optional(),
        milestoneNumber: databaseId.nullable().optional(),
        issueTypeId: databaseId.nullable().optional(),
      })
      .strict()
      .optional(),
    labels: z
      .object({
        add: z.array(labelName).max(100).default([]),
        remove: z.array(labelName).max(100).default([]),
      })
      .optional(),
    issueField: issueFieldChange.optional(),
    projectField: projectFieldChange.optional(),
  }),
};
export type GitHubOperationToolName = keyof typeof githubOperationSchemas;
export interface LabelDefinition extends Label {
  description: string;
}
export interface Reaction {
  id: number;
  content: z.infer<typeof reactionContentSchema>;
  author: string;
}
export interface ReactionList {
  repo: string;
  number: number;
  commentId?: number;
  reactions: Reaction[];
  account: string | null;
}
export interface IssueCatalog {
  repo: string;
  number: number;
  milestoneNumber: number | null;
  issueTypeId: number | null;
  milestones: { number: number; title: string; state: "open" | "closed" }[];
  issueTypes: { id: number; name: string; description: string }[];
  errors: string[];
}
export interface IssueField {
  id: number;
  name: string;
  type: string;
  supported: boolean;
  value: FieldValue;
  options: { id: number; name: string }[];
}
export interface IssueFieldList {
  repo: string;
  number: number;
  organization: string | null;
  fields: IssueField[];
  error?: string;
}
export interface ProjectChoice {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
}
export interface ProjectChoices {
  repo: string;
  owner: string;
  ownerType: "user" | "organization";
  projects: ProjectChoice[];
  hasMore: boolean;
  cursor: string | null;
}
export interface IssueProjectMemberships {
  repo: string;
  number: number;
  memberships: {
    projectId: string;
    itemId: string;
    title: string;
    url: string;
  }[];
  errors: string[];
}
export interface ProjectField {
  id: string;
  name: string;
  type: string;
  supported: boolean;
  value: FieldValue;
  options: { id: string; name: string }[];
  iterations: {
    id: string;
    title: string;
    startDate: string;
    duration: number;
  }[];
}
export interface ProjectFieldList {
  repo: string;
  number: number;
  projectId: string;
  itemId: string;
  fields: ProjectField[];
  hasMore: boolean;
}
export interface RelatedIssue extends IssueRef {
  id: number;
  title: string;
  state: "open" | "closed";
  url: string;
}
export interface IssueRelations {
  repo: string;
  number: number;
  parent: RelatedIssue | null;
  children: RelatedIssue[];
  blockedBy: RelatedIssue[];
  blocking: RelatedIssue[];
  errors: string[];
}
export interface IssueTemplate {
  path: string;
  name: string;
  description: string;
  kind: "simple" | "unsupported";
  url: string;
  reason?: string;
  body?: string;
  defaults?: {
    title: string;
    labels: string[];
    assignees: string[];
    type?: string;
  };
}
export interface IssueTemplates {
  repo: string;
  templates: IssueTemplate[];
}
export interface GitHubOperationResult {
  repo: string;
  number?: number;
  issue?: IssueDetail;
  createdIssue?: IssueDetail;
  changedComment?: Comment;
  label?: LabelDefinition;
  deleted?: boolean;
  projectItemId?: string;
}
export interface BulkUpdateResult {
  results: (
    | { repo: string; number: number; ok: true; issue: IssueDetail }
    | { repo: string; number: number; ok: false; error: string }
  )[];
}
