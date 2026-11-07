import type { QueryClient } from "@tanstack/react-query";
import type {
  ArcoHost,
  ConversationIssue,
  PresentationIssues,
} from "../shared/contracts";
import { githubIssueKey } from "./github-issue-key";
import { linearRef } from "./linear-queries";

type LinearPresentationScope = {
  receivedAfter: number;
  generation?: string | null;
};
const linearPresentationScopes = new WeakMap<
  QueryClient,
  Map<string, LinearPresentationScope>
>();

function linearPresentationScope(client: QueryClient, connectionId: string) {
  let scopes = linearPresentationScopes.get(client);
  if (!scopes) {
    scopes = new Map();
    linearPresentationScopes.set(client, scopes);
  }
  let scope = scopes.get(connectionId);
  if (!scope) {
    scope = { receivedAfter: -Infinity };
    scopes.set(connectionId, scope);
  }
  return scope;
}

export function observeLinearPresentationGeneration(
  client: QueryClient,
  connectionId: string,
  generation: string | null,
) {
  linearPresentationScope(client, connectionId).generation = generation;
}

export function discardLinearPresentation(
  client: QueryClient,
  connectionId: string,
  snapshot: PresentationIssues | null | undefined,
) {
  const scope = linearPresentationScope(client, connectionId);
  scope.receivedAfter = Math.max(
    scope.receivedAfter,
    snapshot?.receivedAt ?? Date.now(),
  );
}

export function canSeedLinearPresentation(
  client: QueryClient,
  connectionId: string,
  snapshot: PresentationIssues | null | undefined,
) {
  const scope = linearPresentationScopes.get(client)?.get(connectionId);
  return (
    scope === undefined ||
    (snapshot !== null &&
      snapshot !== undefined &&
      snapshot.receivedAt > scope.receivedAfter &&
      (scope.generation === undefined ||
        (scope.generation !== null &&
          snapshot.linearAuthGenerations?.[connectionId] === scope.generation)))
  );
}

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
      issue.source === "linear" &&
      !canSeedLinearPresentation(client, issue.connectionId, snapshot)
    )
      continue;
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
