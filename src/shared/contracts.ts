import { z } from "zod";
import type { LinearIssue, LinearRef } from "./linear";
import type { ImageData } from "./images";
import type { LaunchContext } from "./launch";

export const repoSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .refine(
    (repo) => repo.split("/").every((part) => part !== "." && part !== ".."),
    "Invalid repository path",
  );
export const issueRefSchema = z.object({
  repo: repoSchema,
  number: z.number().int().positive(),
});
export const listInputSchema = z.object({
  repo: repoSchema,
  query: z.string().max(500).default(""),
  state: z.enum(["open", "closed", "all"]).default("open"),
  page: z.number().int().min(1).max(100).default(1),
  cursor: z.string().min(1).max(2048).optional(),
  sort: z.enum(["updated", "created", "comments"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});
/** Native account feed has no full-text search parameter; repository search stays separate. */
export const accountIssueFilterSchema = z.enum([
  "assigned",
  "created",
  "mentioned",
  "all",
]);
export const accountIssuesInputSchema = z
  .object({
    filter: accountIssueFilterSchema.default("assigned"),
    state: z.enum(["open", "closed", "all"]).default("open"),
    sort: z.enum(["updated", "created", "comments"]).default("updated"),
    order: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().positive().default(1),
  })
  .strict();
export const repositoriesInputSchema = z
  .object({ page: z.number().int().positive().default(1) })
  .strict();
export const updateInputSchema = issueRefSchema.extend({
  requestId: z.string().min(8).max(100),
  expectedUpdatedAt: z.string().optional(),
  patch: z
    .object({
      title: z.string().min(1).max(256).optional(),
      body: z.string().max(65536).optional(),
      state: z.enum(["open", "closed"]).optional(),
      stateReason: z.enum(["completed", "not_planned", "reopened"]).optional(),
      assignees: z.array(z.string().min(1).max(100)).max(100).optional(),
    })
    .strict(),
});
export const labelInputSchema = issueRefSchema.extend({
  requestId: z.string().min(8).max(100),
  add: z.array(z.string().min(1)).max(100).default([]),
  remove: z.array(z.string().min(1)).max(100).default([]),
});
export const commentInputSchema = issueRefSchema.extend({
  requestId: z.string().min(8).max(100),
  body: z.string().min(1).max(65536),
});
export const commentsInputSchema = issueRefSchema.extend({
  page: z.number().int().positive().default(1),
});
export const createInputSchema = z.object({
  repo: repoSchema,
  requestId: z.string().min(8).max(100),
  title: z.string().min(1).max(256),
  body: z.string().max(65536),
  labels: z.array(z.string().min(1)).max(100).optional(),
  assignees: z.array(z.string().min(1)).max(100).optional(),
  issueTypeName: z.string().min(1).max(256).optional(),
});
export const projectInputSchema = issueRefSchema.extend({
  requestId: z.string().min(8).max(100),
  projectId: z.string().min(1),
  itemId: z.string().min(1),
  fieldId: z.string().min(1),
  optionId: z.string().min(1),
});
export type IssueRef = z.infer<typeof issueRefSchema>;
export type ListInput = z.infer<typeof listInputSchema>;
export type AccountIssuesInput = z.infer<typeof accountIssuesInputSchema>;
export type RepositoriesInput = z.infer<typeof repositoriesInputSchema>;
export type UpdateInput = z.infer<typeof updateInputSchema>;
export type LabelInput = z.infer<typeof labelInputSchema>;
export type CommentInput = z.infer<typeof commentInputSchema>;
export type CommentsInput = z.infer<typeof commentsInputSchema>;
export type CreateInput = z.infer<typeof createInputSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export interface Label {
  id: string;
  name: string;
  color: string;
}
export interface Comment {
  id: string;
  databaseId?: number;
  body: string;
  author: string;
  url: string;
  updatedAt: string;
}
export interface CommentPage {
  comments: Comment[];
  hasMore: boolean;
  nextPage?: number;
}
export interface ProjectStatus {
  projectId: string;
  projectTitle: string;
  itemId: string;
  fieldId: string;
  fieldName: string;
  optionId: string | null;
  options: { id: string; name: string }[];
}
export interface IssueSummary extends IssueRef {
  source: "github";
  id: string;
  title: string;
  state: "open" | "closed";
  updatedAt: string;
  url: string;
  author: string;
  labels: Label[];
  assignees: string[];
}
export interface IssueDetail extends IssueSummary {
  body: string;
  issueType?: { id: number; name: string } | null;
  stateReason: string | null;
  comments: Comment[];
  commentsHasMore: boolean;
  commentsNextPage?: number;
  postedComment?: Comment;
  projects: ProjectStatus[];
  projectsError?: string;
}
export interface IssuePage {
  issues: IssueSummary[];
  hasMore: boolean;
  page: number;
  nextCursor?: string;
}
export interface AccountIssuePage extends IssuePage {
  scope: "account";
  filter: z.infer<typeof accountIssueFilterSchema>;
}
export interface AccessibleRepository {
  id: string;
  repo: string;
  url: string;
  private: boolean;
  archived: boolean;
  issuesEnabled: boolean;
}
export interface RepositoryPage {
  repositories: AccessibleRepository[];
  hasMore: boolean;
  page: number;
}
export interface Connection {
  mode: "fixture" | "github";
  connected: boolean;
  account: string | null;
  message: string;
  defaultRepo: string | null;
}
export interface RepoMetadata {
  labels: Label[];
  assignees: string[];
}
export interface GitHubService {
  connection(): Promise<Connection>;
  list(input: ListInput): Promise<IssuePage>;
  accountIssues(input: AccountIssuesInput): Promise<AccountIssuePage>;
  repositories(input: RepositoriesInput): Promise<RepositoryPage>;
  get(input: IssueRef): Promise<IssueDetail>;
  comments(input: CommentsInput): Promise<CommentPage>;
  readMarkdown(input: IssueRef, commentId?: number): Promise<string>;
  metadata(repo: string): Promise<RepoMetadata>;
  update(input: UpdateInput): Promise<IssueDetail>;
  labels(input: LabelInput): Promise<IssueDetail>;
  comment(input: CommentInput): Promise<IssueDetail>;
  create(input: CreateInput): Promise<IssueDetail>;
  projectStatus(input: ProjectInput): Promise<IssueDetail>;
}

// Host protocol values. Arco advertises and requests only inline/fullscreen.
export type DisplayMode = "inline" | "fullscreen" | "pip";
export interface ContextSelection {
  text: string;
  origin: "body" | "comment" | "ui";
  commentId?: string;
  comment?: string;
}
export type SelectionIssue =
  | Pick<
      IssueSummary,
      "source" | "repo" | "number" | "id" | "title" | "url" | "state"
    >
  | {
      source: "linear";
      connectionId: string;
      workspaceId: string;
      teamId: string;
      id: string;
      identifier: string;
      title: string;
      url: string;
      state: LinearIssue["state"];
    };
export interface TextSelectionContext {
  selection: ContextSelection;
  issue?: SelectionIssue;
}
export interface SelectionAnnotationContext extends TextSelectionContext {
  number: number;
}
export type ConversationIssue = IssueDetail | LinearIssue;
export type SharedIssueRef =
  ({ source: "github" } & IssueRef) | ({ source: "linear" } & LinearRef);
export interface ArcoHost {
  launch?(): LaunchContext | null;
  sharedIssue?(): SharedIssueRef | null;
  sharedAnnotations?(): SelectionAnnotationContext[] | null;
  annotationSnapshotId?(): string | null;
  call<T>(
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal; priority?: "background" | "interactive" },
  ): Promise<T>;
  readImage(
    issue: ConversationIssue,
    url: string,
    commentId?: string | number,
    options?: { signal?: AbortSignal; priority?: "background" | "interactive" },
  ): Promise<ImageData>;
  share(issue: ConversationIssue): Promise<void>;
  shareAnnotations(
    annotations: SelectionAnnotationContext[],
    snapshotId?: string,
  ): Promise<void>;
  openLink(url: string): Promise<void>;
  display(mode: DisplayMode): Promise<void>;
  subscribe(
    listener: (event: "data" | "display" | "context" | "launch") => void,
  ): () => void;
  mode(): DisplayMode;
}
