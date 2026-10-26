import type { QueryClient } from "@tanstack/react-query";
import type {
  ArcoHost,
  ConversationIssue,
  PresentationIssues,
} from "../shared/contracts";
import { githubIssueKey } from "./github-queries";
import { linearRef } from "./linear-queries";

export function seedPresentationCache(
  client: QueryClient,
  host: ArcoHost,
  githubAuthScope?: string,
  presentation?: PresentationIssues,
) {
  const snapshot = presentation ?? host.presentationIssues?.();
  if (!snapshot) return;
  for (const issue of snapshot.issues) {
    if (
      issue.source === "github" &&
      (!githubAuthScope || snapshot.githubAuthGeneration !== githubAuthScope)
    )
      continue;
    const key =
      issue.source === "github"
        ? githubIssueKey(issue, githubAuthScope!)
        : ["linear-issue", linearRef(issue)];
    const current = client.getQueryState<ConversationIssue>(key);
    if (
      current?.data &&
      (current.dataUpdatedAt >= snapshot.receivedAt ||
        Date.parse(current.data.updatedAt) > Date.parse(issue.updatedAt))
    )
      continue;
    client.setQueryData(key, issue, { updatedAt: snapshot.receivedAt });
  }
}
