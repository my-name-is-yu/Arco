import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type { ArcoHost } from "../shared/contracts";
import type {
  LinearIssue,
  LinearMetadata,
  LinearPage,
  LinearRef,
  LinearScope,
} from "../shared/linear";
import type { LinearFilter } from "./useLinearSettings";
import {
  linearCommentChangesKey,
  type LinearCommentChanges,
} from "./linear-comments";

export const linearRef = (issue: LinearRef): LinearRef => ({
  connectionId: issue.connectionId,
  workspaceId: issue.workspaceId,
  teamId: issue.teamId,
  issueId: issue.issueId,
});

export function useLinearIssueList(
  host: ArcoHost,
  {
    scope,
    query,
    filters,
    enabled,
    autoRefresh,
  }: {
    scope: LinearScope | null;
    query: string;
    filters: Omit<LinearFilter, "query">;
    enabled: boolean;
    autoRefresh: boolean;
  },
) {
  return useInfiniteQuery<
    LinearPage,
    Error,
    InfiniteData<LinearPage>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: ["linear-issues", JSON.stringify([scope, query, filters])],
    refetchInterval: (query) =>
      autoRefresh &&
      query.state.data?.pages.length === 1 &&
      query.state.status !== "error"
        ? 30_000
        : false,
    refetchOnWindowFocus: (query) =>
      autoRefresh &&
      query.state.data?.pages.length === 1 &&
      query.state.status !== "error",
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const result = await host.call<LinearPage>(
        "linear_list_issues",
        {
          ...scope,
          query,
          ...Object.fromEntries(
            Object.entries(filters).filter(([, value]) => value),
          ),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        { signal },
      );
      if (result.hasMore && !result.cursor)
        throw new Error(
          "Linear returned no continuation cursor. Refresh the list.",
        );
      return result;
    },
    getNextPageParam: (last) => {
      if (!last.hasMore) return undefined;
      return last.cursor;
    },
    enabled,
  });
}

export function useLinearIssue(
  host: ArcoHost,
  issue: LinearRef | null,
  enabled: boolean,
  poll: boolean,
) {
  return useQuery({
    queryKey: ["linear-issue", issue],
    refetchInterval: poll ? 30_000 : false,
    queryFn: ({ signal }) =>
      host.call<LinearIssue>(
        "linear_get_issue",
        { ...issue },
        { signal, priority: "background" },
      ),
    enabled,
  });
}

export function useLinearMetadata(
  host: ArcoHost,
  scope: LinearScope | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["linear-metadata", scope],
    queryFn: () => host.call<LinearMetadata>("linear_metadata", { ...scope }),
    enabled,
  });
}

export function useLinearIssueCache() {
  const client = useQueryClient();
  return {
    remember(issue: LinearIssue) {
      client.setQueryData(["linear-issue", linearRef(issue)], issue);
      if (issue.changedComment || issue.deletedCommentId)
        client.setQueryData<LinearCommentChanges>(
          linearCommentChangesKey(issue),
          (current = {}) => ({
            ...current,
            ...(issue.changedComment
              ? { [issue.changedComment.id]: issue.changedComment }
              : {}),
            ...(issue.deletedCommentId
              ? { [issue.deletedCommentId]: null }
              : {}),
          }),
        );
    },
    refresh(comments = false) {
      return Promise.all([
        client.invalidateQueries({ queryKey: ["linear-issue"] }),
        client.invalidateQueries({ queryKey: ["linear-issues"] }),
        client.invalidateQueries({ queryKey: ["linear-metadata"] }),
        ...(comments
          ? [client.invalidateQueries({ queryKey: ["linear-comments"] })]
          : []),
      ]);
    },
  };
}
