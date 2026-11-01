import { useEffect, useState } from "react";
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
} from "../shared/linear";
import {
  symphonyIssueMatches,
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
  hint: string;
}[] = [
  {
    value: "preparation",
    label: "Preparation",
    hint: "Configured issue states or labels",
  },
  { value: "working", label: "Working", hint: "Running or retrying" },
  {
    value: "attention",
    label: "Needs attention",
    hint: "Blocked or ready for review",
  },
  { value: "other", label: "Other", hint: "Unmapped work" },
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
  const matched = new Set<string>();
  const items = rows.map((runtime): SymphonyWorkItem => {
    const issue =
      issues.find((candidate) =>
        symphonyIssueMatches(connection.binding, runtime, candidate),
      ) ?? null;
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
  setSessionState(host, "symphony:selected", selection.issueIdentifier ?? null);
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
  return {
    provider,
    issues,
    generation,
    nativeIssues:
      generation && scopeMatches && !provider.isError
        ? (issues.data?.pages.flatMap((page) => page.issues) ?? [])
        : [],
    scopeMatches,
  };
}

export function useSymphonyIssueContext(
  host: ArcoHost,
  issue: SymphonyIssueSummary | null,
  connection: SymphonyConnection | undefined,
  generation: string | null,
  visible: boolean,
) {
  const client = useQueryClient();
  return useQuery({
    queryKey: [
      "symphony-issue-context",
      symphonyConnectionKey(connection),
      connection?.binding,
      issue?.url,
      generation,
    ],
    enabled: Boolean(issue && generation),
    queryFn: async ({ signal }): Promise<ConversationIssue> => {
      const readIdentity = async () => {
        const provider =
          issue!.source === "github"
            ? await host.call<Connection>(
                "arco_connection",
                {},
                { signal, priority: "background" },
              )
            : await host.call<LinearConnection>(
                "linear_connection",
                { connectionId: issue!.connectionId },
                { signal, priority: "background" },
              );
        const current = nativeGeneration(provider);
        if (current !== generation)
          client.setQueryData(
            [
              "symphony-provider",
              issue!.source,
              issue!.source === "linear" ? issue!.connectionId : null,
            ],
            provider,
          );
        return current;
      };
      if ((await readIdentity()) !== generation)
        throw new Error(
          "The issue account changed. Refresh to load its current context.",
        );
      const detail =
        issue!.source === "github"
          ? await host.call<IssueDetail>(
              "arco_get_issue",
              { repo: issue!.repo, number: issue!.number },
              { signal, priority: "background" },
            )
          : await host.call<LinearIssue>(
              "linear_get_issue",
              {
                connectionId: issue!.connectionId,
                workspaceId: issue!.workspaceId,
                teamId: issue!.teamId,
                issueId: issue!.issueId,
              },
              { signal, priority: "background" },
            );
      if ((await readIdentity()) !== generation)
        throw new Error(
          "The issue account changed. Refresh to load its current context.",
        );
      const matches =
        issue!.source === "github"
          ? detail.source === "github" &&
            detail.repo.toLowerCase() === issue!.repo.toLowerCase() &&
            detail.number === issue!.number
          : detail.source === "linear" &&
            detail.connectionId === issue!.connectionId &&
            detail.workspaceId === issue!.workspaceId &&
            detail.teamId === issue!.teamId &&
            detail.issueId === issue!.issueId;
      if (!matches)
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
