import { z } from "zod";

const id = z.string().min(1).max(200);
const requestId = z.string().min(1).max(200);
export const LINEAR_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const linearScopeSchema = z
  .object({ connectionId: id, workspaceId: id, teamId: id })
  .strict();
export const linearRefSchema = linearScopeSchema.extend({ issueId: id });
export const linearPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(256).optional(),
    body: z.string().max(65536).optional(),
    stateId: id.optional(),
    assigneeId: id.nullable().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    estimate: z.number().nonnegative().nullable().optional(),
    dueDate: z.iso.date().nullable().optional(),
    projectId: id.nullable().optional(),
    projectMilestoneId: id.nullable().optional(),
    cycleId: id.nullable().optional(),
    parentId: id.nullable().optional(),
  })
  .strict();
export const linearSchemas = {
  linear_auth_status: z
    .object({ connectionId: id.default("default") })
    .strict(),
  linear_auth_begin: z
    .object({
      connectionId: id.default("default"),
      clientId: id,
      redirectUri: z.url().optional(),
    })
    .strict(),
  linear_auth_disconnect: z
    .object({
      connectionId: id.default("default"),
      revoke: z.boolean().default(false),
    })
    .strict(),
  linear_connection: z.object({ connectionId: id.default("default") }).strict(),
  linear_scopes: z.object({ connectionId: id.default("default") }).strict(),
  linear_metadata: linearScopeSchema,
  linear_list_issues: linearScopeSchema.extend({
    query: z.string().max(500).default(""),
    stateId: id.optional(),
    assigneeId: id.optional(),
    labelId: id.optional(),
    projectId: id.optional(),
    order: z.enum(["updatedAt", "createdAt"]).default("updatedAt"),
    cursor: id.optional(),
  }),
  linear_get_issue: linearRefSchema,
  linear_comments: linearRefSchema.extend({ cursor: id.optional() }),
  linear_resolve_issue: z
    .object({ connectionId: id.default("default"), url: z.string().max(2048) })
    .strict(),
  linear_read_image: linearRefSchema.extend({
    commentId: id.optional(),
    url: z.url(),
  }),
  linear_create_issue: linearScopeSchema.extend({
    requestId,
    title: z.string().trim().min(1).max(256),
    body: z.string().max(65536).optional(),
    parentId: id.optional(),
    templateId: id.optional(),
  }),
  linear_update_issue: linearRefSchema.extend({
    requestId,
    expectedUpdatedAt: z.string().min(1),
    patch: linearPatchSchema.refine(
      (patch) => Object.keys(patch).length > 0,
      "Choose a property to change.",
    ),
  }),
  linear_change_labels: linearRefSchema.extend({
    requestId,
    add: z.array(id).max(100).default([]),
    remove: z.array(id).max(100).default([]),
  }),
  linear_label_definition: linearScopeSchema.extend({
    requestId,
    action: z.enum(["create", "update", "delete"]),
    labelId: id.optional(),
    name: z.string().trim().min(1).max(100).optional(),
    color: z
      .string()
      .regex(/^#[a-f\d]{6}$/i)
      .optional(),
    description: z.string().max(2000).optional(),
    scope: z.enum(["workspace", "team"]).default("team"),
  }),
  linear_comment: linearRefSchema.extend({
    requestId,
    action: z.enum(["create", "update", "delete"]),
    commentId: id.optional(),
    expectedUpdatedAt: z.string().min(1).optional(),
    parentId: id.optional(),
    body: z.string().min(1).max(65536).optional(),
  }),
  linear_reaction: linearRefSchema.extend({
    requestId,
    action: z.enum(["add", "remove"]),
    commentId: id.optional(),
    emoji: z.string().min(1).max(100),
    reactionId: id.optional(),
  }),
  linear_relation: linearRefSchema.extend({
    requestId,
    action: z.enum(["add", "remove"]),
    relatedIssueId: id.optional(),
    relationId: id.optional(),
    kind: z.enum(["blocks", "blocked-by", "related"]),
  }),
  linear_upload: linearRefSchema.extend({
    requestId,
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(200),
    base64: z.string().max(Math.ceil(LINEAR_UPLOAD_MAX_BYTES / 3) * 4),
  }),
  linear_templates: linearScopeSchema,
  linear_bulk: linearScopeSchema.extend({
    requestId,
    issueIds: z.array(id).min(1).max(50),
    patch: linearPatchSchema
      .pick({
        stateId: true,
        assigneeId: true,
        priority: true,
        estimate: true,
        dueDate: true,
      })
      .optional(),
    addLabels: z.array(id).max(100).optional(),
    removeLabels: z.array(id).max(100).optional(),
  }),
};
export type LinearToolName = keyof typeof linearSchemas;
export type LinearScope = z.infer<typeof linearScopeSchema>;
export type LinearRef = z.infer<typeof linearRefSchema>;
export interface LinearSavedReceipt extends LinearRef {
  kind: "linear_saved_receipt";
  saved: true;
  operation: "create_issue" | "create_comment";
  commentId?: string;
  message: string;
}
export interface LinearNamed {
  id: string;
  name: string;
}
export interface LinearLabel extends LinearNamed {
  color: string;
  description: string | null;
  teamId: string | null;
  parentId: string | null;
  isGroup: boolean;
}
export interface LinearComment {
  id: string;
  body: string;
  author: string;
  authorId: string;
  parentId: string | null;
  updatedAt: string;
  url: string;
  reactions: { id: string; emoji: string; userId: string }[];
}
export interface LinearCommentPage {
  comments: LinearComment[];
  hasMore: boolean;
  cursor: string | null;
}
export interface LinearIssue extends LinearRef {
  source: "linear";
  identifier: string;
  title: string;
  body: string;
  url: string;
  updatedAt: string;
  author: string;
  state: LinearNamed & { type: string; color: string };
  assignee: LinearNamed | null;
  labels: LinearLabel[];
  priority: number;
  estimate: number | null;
  dueDate: string | null;
  project: LinearNamed | null;
  projectMilestone: LinearNamed | null;
  cycle: LinearNamed | null;
  parent: { id: string; identifier: string; title: string } | null;
  children: { id: string; identifier: string; title: string }[];
  comments: LinearComment[];
  commentsHasMore: boolean;
  commentsCursor?: string | null;
  changedComment?: LinearComment;
  deletedCommentId?: string;
  attachments: { id: string; title: string; url: string }[];
  relations: {
    id: string;
    type: string;
    issueId: string;
    relatedIssueId: string;
    identifier: string;
    title: string;
  }[];
  reactions: { id: string; emoji: string; userId: string }[];
}
export interface LinearMetadata {
  states: (LinearNamed & { type: string; color: string })[];
  members: LinearNamed[];
  labels: LinearLabel[];
  projects: LinearNamed[];
  cycles: LinearNamed[];
  milestones: (LinearNamed & { projectId: string })[];
  estimateValues: number[];
}
export type LinearIssueSummary = Pick<
  LinearIssue,
  | "source"
  | "connectionId"
  | "workspaceId"
  | "teamId"
  | "issueId"
  | "identifier"
  | "title"
  | "url"
  | "updatedAt"
  | "state"
>;
export interface LinearPage {
  issues: LinearIssueSummary[];
  hasMore: boolean;
  cursor: string | null;
}
export interface LinearConnection {
  connected: boolean;
  connectionId: string;
  mode: "linear" | "fixture";
  account: string | null;
  userId: string | null;
  workspace: LinearNamed | null;
  message: string;
}
export interface LinearScopes {
  workspace: LinearNamed;
  teams: (LinearNamed & { key: string })[];
}
export interface LinearTemplate {
  id: string;
  name: string;
  description: string | null;
  supported: boolean;
  reason?: string;
  defaults?: Omit<z.infer<typeof linearPatchSchema>, "parentId"> & {
    labelIds?: string[];
  };
}
export interface LinearService {
  call(name: LinearToolName, args: unknown): Promise<object>;
}
