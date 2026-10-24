import type { QueryClient } from "@tanstack/react-query";
import type { ArcoHost, ConversationIssue } from "../shared/contracts";
import { githubIssueKey } from "./github-queries";
import { linearRef } from "./linear-queries";

export function seedPresentationCache(client: QueryClient, host: ArcoHost) {
  const snapshot = host.presentationIssues?.();
  if (!snapshot) return;
  for (const issue of snapshot.issues) {
    const key =
      issue.source === "github"
        ? githubIssueKey(issue)
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
