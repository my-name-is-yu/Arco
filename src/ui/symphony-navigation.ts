import {
  symphonyIssueMatches,
  type SymphonyBinding,
  type SymphonyConnection,
  type SymphonyNativeIssue,
  type SymphonySelection,
} from "../shared/symphony";
import type { SymphonyWorkItem } from "./symphony-queries";

export function symphonyBindingContainsIssue(
  binding: SymphonyBinding | undefined,
  issue: SymphonyNativeIssue,
): boolean {
  if (binding?.source === "github")
    return (
      "repo" in issue && binding.repo.toLowerCase() === issue.repo.toLowerCase()
    );
  return (
    binding?.source === "linear" &&
    "issueId" in issue &&
    binding.connectionId === issue.connectionId &&
    binding.workspaceId === issue.workspaceId &&
    binding.teamId === issue.teamId &&
    (!binding.projectId || binding.projectId === issue.project?.id)
  );
}

function sameNativeIssue(
  left: SymphonyNativeIssue,
  right: SymphonyNativeIssue,
): boolean {
  if ("repo" in left || "repo" in right)
    return (
      "repo" in left &&
      "repo" in right &&
      left.repo.toLowerCase() === right.repo.toLowerCase() &&
      left.number === right.number
    );
  return (
    left.connectionId === right.connectionId &&
    left.workspaceId === right.workspaceId &&
    left.teamId === right.teamId &&
    left.issueId === right.issueId
  );
}

export function resolveSymphonySelection(
  connection: SymphonyConnection,
  items: SymphonyWorkItem[],
  selection: SymphonySelection,
): SymphonyWorkItem | undefined {
  if (selection.connectionId !== connection.id) return undefined;
  if (selection.nativeIssue) {
    const nativeIssue = selection.nativeIssue;
    if (!symphonyBindingContainsIssue(connection.binding, nativeIssue))
      return undefined;
    const runtime = items.filter(
      (item) =>
        item.runtime &&
        symphonyIssueMatches(connection.binding, item.runtime, nativeIssue),
    );
    if (runtime.length === 1) return runtime[0];
    if (runtime.length > 1) return undefined;
    const native = items.filter(
      (item) =>
        !item.runtime &&
        item.issue &&
        symphonyBindingContainsIssue(connection.binding, item.issue) &&
        sameNativeIssue(item.issue, nativeIssue),
    );
    return native.length === 1 ? native[0] : undefined;
  }
  const candidates = items.filter(
    (item) => item.identifier === selection.issueIdentifier,
  );
  const runtime = candidates.filter((item) => item.runtime);
  return runtime.length === 1
    ? runtime[0]
    : candidates.length === 1
      ? candidates[0]
      : undefined;
}
