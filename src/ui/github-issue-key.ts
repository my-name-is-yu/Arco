import type { IssueRef } from "../shared/contracts";

export const githubIssueKey = (issue: IssueRef, scope: string) =>
  ["issue", issue.repo, issue.number, scope] as const;
