import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ArcoHost,
  Connection,
  ConversationIssue,
  IssueDetail,
  IssuePage,
  IssueSummary,
} from "../shared/contracts";
import type {
  LinearConnection,
  LinearIssue,
  LinearIssueSummary,
  LinearPage,
  LinearRef,
} from "../shared/linear";
import { githubIssueUrl, linearIssueUrl } from "../shared/issue-url";
import {
  symphonyIssueMatches,
  symphonyIssueUrl,
  type SymphonyBinding,
  type SymphonyConnection,
  type SymphonyRuntimeRow,
  type SymphonySelection,
  type SymphonySnapshot,
} from "../shared/symphony";
import { setSessionState } from "./session-state";

export type SymphonyIssueSummary =
  IssueSummary | (LinearIssueSummary & { project?: { id: string } | null });
export type SymphonyGroup = "preparation" | "working" | "attention" | "other";
export const symphonyGroups: {
  value: SymphonyGroup;
  label: string;
}[] = [
  { value: "preparation", label: "Preparation" },
  { value: "working", label: "Working" },
  { value: "attention", label: "Needs attention" },
  { value: "other", label: "Other" },
];
export interface SymphonyWorkItem {
  key: string;
  identifier: string;
  title: string;
  issue: SymphonyIssueSummary | null;
  runtime: SymphonyRuntimeRow | null;
  group: SymphonyGroup;
}

export function symphonyIssueIdentifier(issue: SymphonyIssueSummary): string {
  return issue.source === "github" ? `GH-${issue.number}` : issue.identifier;
}

export function classifySymphonyWork(
  runtime: SymphonyRuntimeRow | null,
  issue: SymphonyIssueSummary | null,
  binding?: SymphonyBinding,
): SymphonyGroup {
  if (runtime?.runtimeStatus === "blocked") return "attention";
  if (runtime) return "working";
  if (!binding || !issue) return "other";
  if (binding.source === "github" && issue.source === "github") {
    const names = new Set(issue.labels.map((label) => label.name));
    if (binding.reviewLabels.some((label) => names.has(label)))
      return "attention";
    if (binding.prepareLabels.some((label) => names.has(label)))
      return "preparation";
  }
  if (binding.source === "linear" && issue.source === "linear") {
    if (binding.reviewStateIds.includes(issue.state.id)) return "attention";
    if (binding.prepareStateIds.includes(issue.state.id)) return "preparation";
  }
  return "other";
}

export function symphonyWorkItems(
  connection: SymphonyConnection,
  rows: SymphonyRuntimeRow[],
  issues: SymphonyIssueSummary[],
): SymphonyWorkItem[] {
  const binding = connection.binding;
  const byUrl = new Map<string, SymphonyIssueSummary>();
  const byId = new Map<string, SymphonyIssueSummary>();
  for (const issue of issues) {
    let id: string;
    let url: string | null;
    if (binding?.source === "github" && issue.source === "github") {
      if (binding.repo.toLowerCase() !== issue.repo.toLowerCase()) continue;
      id = String(issue.number);
      const expected = `github.com/${binding.repo.toLowerCase()}/issues/${id}`;
      url = symphonyIssueUrl(issue.url) === expected ? expected : null;
    } else if (binding?.source === "linear" && issue.source === "linear") {
      if (
        issue.connectionId !== binding.connectionId ||
        issue.workspaceId !== binding.workspaceId ||
        issue.teamId !== binding.teamId ||
        (binding.projectId && issue.project?.id !== binding.projectId)
      )
        continue;
      id = issue.issueId;
      url = symphonyIssueUrl(issue.url);
    } else continue;
    // Keep the first native match, as with the original ordered lookup.
    if (!byId.has(id)) byId.set(id, issue);
    if (url && !byUrl.has(url)) byUrl.set(url, issue);
  }
  const matched = new Set<string>();
  const items = rows.map((runtime): SymphonyWorkItem => {
    let issue = runtime.issueUrl
      ? (byUrl.get(symphonyIssueUrl(runtime.issueUrl) ?? "") ?? null)
      : (byId.get(runtime.issueId) ?? null);
    if (
      issue &&
      !runtime.issueUrl &&
      binding?.source === "github" &&
      runtime.issueIdentifier !== symphonyIssueIdentifier(issue)
    )
      issue = null;
    if (issue) matched.add(issue.url);
    return {
      key: runtime.key,
      identifier: runtime.issueIdentifier,
      title: issue?.title ?? runtime.issueIdentifier,
      issue,
      runtime,
      group: classifySymphonyWork(runtime, issue, connection.binding),
    };
  });
  for (const issue of issues) {
    if (matched.has(issue.url)) continue;
    items.push({
      key: JSON.stringify([connection.id, issue.url]),
      identifier: symphonyIssueIdentifier(issue),
      title: issue.title,
      issue,
      runtime: null,
      group: classifySymphonyWork(null, issue, connection.binding),
    });
  }
  return items;
}

export function openSymphonyRun(host: ArcoHost, selection: SymphonySelection) {
  setSessionState(host, "symphony:connectionId", selection.connectionId);
  setSessionState(host, "symphony:selected", selection);
  setSessionState(host, "active-source", "symphony");
}

export function useSymphonyVisible() {
  const [visible, setVisible] = useState(
    () =>
      typeof document !== "undefined" && document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function symphonyConnectionKey(
  connection: SymphonyConnection | undefined,
) {
  return connection
    ? JSON.stringify([connection.id, connection.baseUrl])
    : null;
}

export function useSymphonyState(
  host: ArcoHost,
  connection: SymphonyConnection | undefined,
  visible: boolean,
) {
  return useQuery({
    queryKey: ["symphony-state", symphonyConnectionKey(connection)],
    enabled: Boolean(connection),
    queryFn: ({ signal }) =>
      host.call<SymphonySnapshot>(
        "arco_symphony_state",
        { connectionId: connection!.id },
        { signal, priority: "background" },
      ),
    refetchInterval: visible ? 5_000 : false,
    refetchOnWindowFocus: visible,
    refetchIntervalInBackground: false,
  });
}

type NativeConnection = Connection | LinearConnection;
export function nativeGeneration(
  connection: NativeConnection | undefined,
): string | null {
  if (!connection?.connected) return null;
  return JSON.stringify([
    connection.mode,
    connection.userId,
    "workspace" in connection ? connection.workspace?.id : null,
    "authGeneration" in connection ? connection.authGeneration : null,
  ]);
}

export function useSymphonyNativeIssues(
  host: ArcoHost,
  connection: SymphonyConnection | undefined,
  visible: boolean,
) {
  const binding = connection?.binding;
  const client = useQueryClient();
  const providerKey = [
    "symphony-provider",
    binding?.source,
    binding?.source === "linear" ? binding.connectionId : null,
  ];
  const readConnection = () =>
    binding?.source === "linear"
      ? host.call<LinearConnection>(
          "linear_connection",
          { connectionId: binding.connectionId },
          { priority: "background" },
        )
      : host.call<Connection>(
          "arco_connection",
          {},
          { priority: "background" },
        );
  const provider = useQuery<NativeConnection>({
    queryKey: providerKey,
    enabled: Boolean(binding),
    queryFn: readConnection,
    refetchInterval: visible ? 30_000 : false,
    refetchOnWindowFocus: visible,
  });
  const scopeMatches =
    binding?.source !== "linear" ||
    (provider.data &&
      "workspace" in provider.data &&
      provider.data.workspace?.id === binding.workspaceId);
  const generation =
    !provider.isError && scopeMatches ? nativeGeneration(provider.data) : null;
  const issues = useInfiniteQuery({
    queryKey: [
      "symphony-native-issues",
      symphonyConnectionKey(connection),
      binding,
      generation,
    ],
    enabled: Boolean(
      binding && generation && scopeMatches && !provider.isError,
    ),
    initialPageParam: { page: 1 } as { page: number; cursor?: string },
    queryFn: async ({ pageParam, signal }) => {
      const before = await readConnection();
      if (nativeGeneration(before) !== generation) {
        client.setQueryData(providerKey, before);
        throw new Error(
          "The issue account changed. Refresh to load its current work.",
        );
      }
      let page: {
        issues: SymphonyIssueSummary[];
        hasMore: boolean;
        next?: { page: number; cursor?: string };
      };
      if (binding!.source === "github") {
        const result = await host.call<IssuePage>(
          "arco_list_issues",
          {
            repo: binding!.repo,
            query: "",
            state: "open",
            sort: "updated",
            order: "desc",
            ...pageParam,
          },
          { signal, priority: "background" },
        );
        if (result.hasMore && !result.nextCursor)
          throw new Error(
            "GitHub returned no continuation cursor. Refresh to try again.",
          );
        page = {
          issues: result.issues,
          hasMore: result.hasMore,
          ...(result.hasMore
            ? { next: { page: result.page + 1, cursor: result.nextCursor } }
            : {}),
        };
      } else {
        const scope = binding!;
        const result = await host.call<LinearPage>(
          "linear_list_issues",
          {
            connectionId: scope.connectionId,
            workspaceId: scope.workspaceId,
            teamId: scope.teamId,
            ...(scope.projectId ? { projectId: scope.projectId } : {}),
            ...(pageParam.cursor ? { cursor: pageParam.cursor } : {}),
            query: "",
            order: "updatedAt",
          },
          { signal, priority: "background" },
        );
        if (result.hasMore && !result.cursor)
          throw new Error(
            "Linear returned no continuation cursor. Refresh to try again.",
          );
        page = {
          issues: result.issues.map((issue) => ({
            ...issue,
            ...(scope.projectId ? { project: { id: scope.projectId } } : {}),
          })),
          hasMore: result.hasMore,
          ...(result.hasMore
            ? { next: { page: pageParam.page + 1, cursor: result.cursor! } }
            : {}),
        };
      }
      const after = await readConnection();
      if (nativeGeneration(after) !== generation) {
        client.setQueryData(providerKey, after);
        throw new Error(
          "The issue account changed. Refresh to load its current work.",
        );
      }
      return page;
    },
    getNextPageParam: (last) => last.next,
    refetchInterval: visible ? 30_000 : false,
    refetchOnWindowFocus: visible,
  });
  const nativeIssues = useMemo(
    () =>
      generation && scopeMatches && !provider.isError
        ? (issues.data?.pages.flatMap((page) => page.issues) ?? [])
        : [],
    [generation, scopeMatches, provider.isError, issues.data?.pages],
  );
  return { provider, issues, generation, nativeIssues, scopeMatches };
}

export function useSymphonyIssueContext(
  host: ArcoHost,
  issue: SymphonyIssueSummary | null,
  connection: SymphonyConnection | undefined,
  generation: string | null,
  visible: boolean,
  runtime?: SymphonyRuntimeRow | null,
) {
  const client = useQueryClient();
  const binding = connection?.binding;
  let target: { repo: string; number: number } | { url: string } | null = null;
  if (!issue && runtime?.issueUrl && binding) {
    try {
      if (binding.source === "github") {
        const ref = githubIssueUrl(runtime.issueUrl);
        if (ref.repo.toLowerCase() === binding.repo.toLowerCase()) target = ref;
      } else {
        linearIssueUrl(runtime.issueUrl);
        target = { url: runtime.issueUrl };
      }
    } catch {
      // An unbound or noncanonical runtime stays visible without native reads.
    }
  }
  return useQuery({
    queryKey: [
      "symphony-issue-context",
      symphonyConnectionKey(connection),
      connection?.binding,
      issue?.url,
      runtime?.issueId,
      runtime?.issueUrl,
      generation,
    ],
    enabled: Boolean(binding && generation && (issue || target)),
    queryFn: async ({ signal }): Promise<ConversationIssue | null> => {
      if (!binding || (issue && issue.source !== binding.source)) return null;
      const readIdentity = async () => {
        const provider =
          binding.source === "github"
            ? await host.call<Connection>(
                "arco_connection",
                {},
                { signal, priority: "background" },
              )
            : await host.call<LinearConnection>(
                "linear_connection",
                { connectionId: binding.connectionId },
                { signal, priority: "background" },
              );
        const current = nativeGeneration(provider);
        if (current !== generation)
          client.setQueryData(
            [
              "symphony-provider",
              binding.source,
              binding.source === "linear" ? binding.connectionId : null,
            ],
            provider,
          );
        return current;
      };
      if ((await readIdentity()) !== generation)
        throw new Error(
          "The issue account changed. Refresh to load its current context.",
        );
      let detail: ConversationIssue;
      if (binding.source === "github") {
        const ref = issue?.source === "github" ? issue : target;
        if (
          !ref ||
          !("repo" in ref) ||
          ref.repo.toLowerCase() !== binding.repo.toLowerCase()
        )
          return null;
        detail = await host.call<IssueDetail>(
          "arco_get_issue",
          { repo: ref.repo, number: ref.number },
          { signal, priority: "background" },
        );
      } else {
        const ref =
          issue?.source === "linear"
            ? issue
            : target && "url" in target
              ? await host.call<LinearRef>(
                  "linear_resolve_issue",
                  { connectionId: binding.connectionId, url: target.url },
                  { signal, priority: "background" },
                )
              : null;
        if (
          !ref ||
          ref.connectionId !== binding.connectionId ||
          ref.workspaceId !== binding.workspaceId ||
          ref.teamId !== binding.teamId
        )
          return null;
        // Project membership must be established without reading an out-of-scope body.
        if (!issue && binding.projectId && target && "url" in target) {
          const scoped = await host.call<LinearPage>(
            "linear_list_issues",
            {
              connectionId: binding.connectionId,
              workspaceId: binding.workspaceId,
              teamId: binding.teamId,
              projectId: binding.projectId,
              query: linearIssueUrl(target.url).identifier,
              order: "updatedAt",
            },
            { signal, priority: "background" },
          );
          if (
            !scoped.issues.some(
              (candidate) =>
                candidate.issueId === ref.issueId &&
                candidate.connectionId === ref.connectionId &&
                candidate.workspaceId === ref.workspaceId &&
                candidate.teamId === ref.teamId,
            )
          )
            return null;
        }
        if ((await readIdentity()) !== generation)
          throw new Error(
            "The issue account changed. Refresh to load its current context.",
          );
        detail = await host.call<LinearIssue>(
          "linear_get_issue",
          {
            connectionId: ref.connectionId,
            workspaceId: ref.workspaceId,
            teamId: ref.teamId,
            issueId: ref.issueId,
          },
          { signal, priority: "background" },
        );
      }
      if ((await readIdentity()) !== generation)
        throw new Error(
          "The issue account changed. Refresh to load its current context.",
        );
      const matches = issue
        ? issue.source === "github"
          ? detail.source === "github" &&
            detail.repo.toLowerCase() === issue.repo.toLowerCase() &&
            detail.number === issue.number
          : detail.source === "linear" &&
            detail.connectionId === issue.connectionId &&
            detail.workspaceId === issue.workspaceId &&
            detail.teamId === issue.teamId &&
            detail.issueId === issue.issueId
        : runtime && symphonyIssueMatches(binding, runtime, detail);
      if (
        !matches ||
        (runtime && !symphonyIssueMatches(binding, runtime, detail))
      )
        throw new Error(
          "The provider returned a different issue. Refresh to try again.",
        );
      return detail;
    },
    refetchInterval: visible ? 30_000 : false,
    refetchOnWindowFocus: visible,
  });
}

export function relativeSymphonyTime(
  value: string | null,
  now = Date.now(),
): string {
  if (!value) return "—";
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return "—";
  const seconds = Math.max(0, Math.floor((now - date) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
