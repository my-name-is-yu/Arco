import { z } from "zod";
import {
  repoSchema,
  type Comment,
  type IssueSummary,
  type Label,
} from "../../shared/contracts.js";
import { GitHubError } from "./transport";
export const apiLabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
});

export const apiIssueSummarySchema = z.object({
  node_id: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  updated_at: z.string(),
  html_url: z.string(),
  user: z.object({ login: z.string() }).nullable(),
  labels: z.array(apiLabelSchema),
  assignees: z.array(z.object({ login: z.string() })),
  pull_request: z.unknown().optional(),
  repository_url: z.string().optional(),
});

export const apiIssueSchema = apiIssueSummarySchema.extend({
  body: z.string().nullable().optional(),
  state_reason: z.string().nullable().optional(),
  type: z
    .object({ id: z.number().int().positive(), name: z.string() })
    .nullable()
    .optional(),
});

export const apiCommentSchema = z.object({
  id: z.number().int().positive().optional(),
  node_id: z.string(),
  body: z.string(),
  user: z.object({ login: z.string() }).nullable(),
  html_url: z.string(),
  updated_at: z.string(),
  issue_url: z.string().optional(),
});

export const apiRepositorySchema = z.object({
  node_id: z.string(),
  full_name: repoSchema,
  html_url: z.url(),
  private: z.boolean(),
  archived: z.boolean(),
  has_issues: z.boolean(),
});

export function labelDto(label: z.infer<typeof apiLabelSchema>): Label {
  return { id: String(label.id), name: label.name, color: label.color };
}

export function commentDto(comment: z.infer<typeof apiCommentSchema>): Comment {
  return {
    id: comment.node_id,
    ...(comment.id !== undefined ? { databaseId: comment.id } : {}),
    body: comment.body,
    author: comment.user?.login ?? "ghost",
    url: comment.html_url,
    updatedAt: comment.updated_at,
  };
}

export function summary(
  repo: string,
  issue: z.infer<typeof apiIssueSummarySchema>,
): IssueSummary {
  if (issue.pull_request !== undefined)
    throw new GitHubError("This target is not an issue.", "invalid");
  return {
    repo,
    number: issue.number,
    source: "github",
    id: issue.node_id,
    title: issue.title,
    state: issue.state,
    updatedAt: issue.updated_at,
    url: issue.html_url,
    author: issue.user?.login ?? "ghost",
    labels: issue.labels.map(labelDto),
    assignees: issue.assignees.map((person) => person.login),
  };
}

export function accountIssueRepo(
  issue: z.infer<typeof apiIssueSummarySchema>,
): string {
  const match = /^https:\/\/api\.github\.com\/repos\/([^/?#]+\/[^/?#]+)$/i.exec(
    issue.repository_url ?? "",
  );
  const repo = repoSchema.safeParse(match?.[1]);
  if (!repo.success)
    throw new GitHubError(
      "GitHub returned an issue without a valid repository identity.",
    );
  const parsedUrl = z.url().safeParse(issue.html_url);
  if (!parsedUrl.success)
    throw new GitHubError("GitHub returned an invalid issue URL.");
  const sourceUrl = new URL(parsedUrl.data);
  if (
    sourceUrl.origin !== "https://github.com" ||
    sourceUrl.username ||
    sourceUrl.password ||
    sourceUrl.search ||
    sourceUrl.hash ||
    sourceUrl.pathname.toLowerCase() !==
      `/${repo.data}/issues/${issue.number}`.toLowerCase()
  )
    throw new GitHubError(
      "GitHub returned conflicting issue repository identities.",
    );
  return repo.data;
}
