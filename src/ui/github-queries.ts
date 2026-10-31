import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type {
  ArcoHost,
  AccountIssuePage,
  AccountIssuesInput,
  Comment,
  Connection,
  IssueDetail,
  IssuePage,
  IssueRef,
  ListInput,
  RepoMetadata,
} from "../shared/contracts";
import {
  useGitHubAuthScope,
  useGitHubCall,
  isGitHubAuthScope,
} from "./github-auth";
import {
  commentsKey,
  commentPostsKey,
  mergeCommentPages,
} from "./github-comments";
import { githubIssueKey } from "./github-issue-key";

export { githubIssueKey } from "./github-issue-key";
type PageParam = { page: number; cursor?: string };

export function useGitHubIssueList(
  host: ArcoHost,
  {
    connection,
    repo,
    accountView,
    query,
    state,
    sort,
    order,
    enabled,
    visible,
  }: Pick<ListInput, "repo" | "query" | "state" | "sort" | "order"> & {
    connection: Connection | undefined;
    accountView: AccountIssuesInput["filter"];
    enabled: boolean;
    visible: boolean;
  },
) {
  const authScope = useGitHubAuthScope();
  const call = useGitHubCall(host);
  const result = useInfiniteQuery<
    IssuePage,
    Error,
    InfiniteData<IssuePage>,
    readonly unknown[],
    PageParam
  >({
    queryKey: [
      "issues",
      connection?.mode,
      connection?.account,
      connection?.connected,
      repo,
      accountView,
      query,
      state,
      sort,
      order,
      authScope,
    ],
    // Bound automatic refresh to one page. Explicit refresh updates every page.
    refetchInterval: (query) =>
      visible &&
      query.state.data?.pages.length === 1 &&
      query.state.status !== "error"
        ? 30_000
        : false,
    refetchOnWindowFocus: (query) =>
      visible &&
      query.state.data?.pages.length === 1 &&
      query.state.status !== "error",
    queryFn: async ({ pageParam, signal }) => {
      const result = await (repo
        ? call<IssuePage>(
            "arco_list_issues",
            { repo, query, state, sort, order, ...pageParam },
            { signal, priority: "background" },
          )
        : call<AccountIssuePage>(
            "arco_account_issues",
            { filter: accountView, state, sort, order, page: pageParam.page },
            { signal, priority: "background" },
          ));
      if (repo && result.hasMore && !result.nextCursor)
        throw new Error(
          "GitHub returned no continuation cursor. Refresh the list.",
        );
      return result;
    },
    enabled,
    initialPageParam: { page: 1 },
    getNextPageParam: (last) => {
      if (!last.hasMore) return undefined;
      return {
        page: last.page + 1,
        ...(repo ? { cursor: last.nextCursor! } : {}),
      };
    },
  });
  const wasVisible = useRef(visible);
  const { isStale, isError, refetch } = result;
  const pageCount = result.data?.pages.length;
  useEffect(() => {
    const returning = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (returning && enabled && isStale && !isError && pageCount === 1)
      void refetch({ cancelRefetch: false });
  }, [visible, enabled, isStale, isError, pageCount, refetch]);
  return result;
}

export function useGitHubIssue(
  host: ArcoHost,
  issue: IssueRef | null,
  enabled: boolean,
  visible: boolean,
) {
  const client = useQueryClient();
  const authScope = useGitHubAuthScope();
  const call = useGitHubCall(host);
  const key = issue
    ? githubIssueKey(issue, authScope)
    : ["issue", "none", authScope];
  const result = useQuery({
    queryKey: key,
    refetchInterval: visible ? 30_000 : false,
    refetchOnWindowFocus: visible,
    queryFn: ({ signal }) =>
      call<IssueDetail>(
        "arco_get_issue",
        { repo: issue!.repo, number: issue!.number },
        {
          signal,
          priority: client.getQueryData(key) ? "background" : "interactive",
        },
      ),
    enabled,
  });
  const wasVisible = useRef(visible);
  const { isStale, refetch } = result;
  useEffect(() => {
    const returning = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (returning && enabled && isStale) void refetch({ cancelRefetch: false });
  }, [visible, enabled, isStale, refetch]);
  return result;
}

export function useGitHubMetadata(
  host: ArcoHost,
  repo: string | undefined,
  enabled: boolean,
) {
  const authScope = useGitHubAuthScope();
  const call = useGitHubCall(host);
  return useQuery({
    queryKey: ["metadata", repo, authScope],
    queryFn: ({ signal }) =>
      call<RepoMetadata>(
        "arco_repo_metadata",
        { repo },
        { signal, priority: "background" },
      ),
    enabled,
  });
}

export function useGitHubIssueMutation(host: ArcoHost) {
  const client = useQueryClient();
  const authScope = useGitHubAuthScope();
  const call = useGitHubCall(host);
  return useMutation({
    mutationFn: ({
      name,
      args,
    }: {
      name: string;
      args: Record<string, unknown>;
    }) => call<IssueDetail>(name, args),
    onSuccess: async (result) => {
      if (result.postedComment)
        client.setQueryData<Comment[]>(
          commentPostsKey(result, authScope),
          (previous = []) =>
            mergeCommentPages([], [...previous, result.postedComment!]),
        );
      client.setQueryData(githubIssueKey(result, authScope), result);
      if (!isGitHubAuthScope(client, authScope)) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: ["issues"] }),
        client.invalidateQueries({ queryKey: ["issue-set"] }),
        client.invalidateQueries({
          queryKey: githubIssueKey(result, authScope),
        }),
        client.invalidateQueries({ queryKey: commentsKey(result, authScope) }),
      ]);
    },
  });
}
