import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  replaceEqualDeep,
  type InfiniteData,
} from "@tanstack/react-query";
import type { ArcoHost } from "../shared/contracts";
import type {
  LinearComment,
  LinearCommentPage,
  LinearIssue,
  LinearRef,
} from "../shared/linear";

export type LinearCommentChanges = Record<string, LinearComment | null>;
export const linearCommentsKey = (issue: LinearRef) =>
  [
    "linear-comments",
    {
      connectionId: issue.connectionId,
      workspaceId: issue.workspaceId,
      teamId: issue.teamId,
      issueId: issue.issueId,
    },
  ] as const;
export const linearCommentChangesKey = (issue: LinearRef) =>
  ["linear-comment-changes", linearCommentsKey(issue)[1]] as const;
const firstPage = (issue: LinearIssue): LinearCommentPage => ({
  comments: issue.comments,
  hasMore: issue.commentsHasMore,
  cursor: issue.commentsCursor ?? null,
});

export function displayedLinearComments(
  pages: LinearCommentPage[],
  changes: LinearCommentChanges,
) {
  const comments = new Map<string, LinearComment>();
  for (const page of pages)
    for (const comment of page.comments) comments.set(comment.id, comment);
  for (const [id, comment] of Object.entries(changes)) {
    if (!comment) comments.delete(id);
    else if (
      comment &&
      (!comments.has(id) || comment.updatedAt >= comments.get(id)!.updatedAt)
    )
      comments.set(id, comment);
  }
  return [...comments.values()];
}

export function reconcileLinearCommentChanges(
  pages: LinearCommentPage[],
  changes: LinearCommentChanges,
) {
  const source = new Map(
    pages
      .flatMap((page) => page.comments)
      .map((comment) => [comment.id, comment]),
  );
  const confirmed = Object.entries(changes).filter(([id, changed]) => {
    const current = source.get(id);
    return (
      changed &&
      current &&
      (current.updatedAt > changed.updatedAt ||
        JSON.stringify(current) === JSON.stringify(changed))
    );
  });
  if (!confirmed.length) return changes;
  const next = { ...changes };
  for (const [id] of confirmed) delete next[id];
  return next;
}

export function useLinearComments(host: ArcoHost, issue: LinearIssue) {
  const cache = useQueryClient();
  const { connectionId, workspaceId, teamId, issueId } = issue;
  const key = useMemo(
    () => linearCommentsKey({ connectionId, workspaceId, teamId, issueId }),
    [connectionId, workspaceId, teamId, issueId],
  );
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    initialData: { pages: [firstPage(issue)], pageParams: [undefined] },
    structuralSharing: (previous, incoming) => {
      const pages = incoming as InfiniteData<
        LinearCommentPage,
        string | undefined
      >;
      const current = cache.getQueryData<LinearIssue>(["linear-issue", key[1]]);
      if (!current) return replaceEqualDeep(previous, pages);
      return replaceEqualDeep(previous, {
        pages: [
          firstPage(current),
          ...(current.commentsHasMore ? pages.pages.slice(1) : []),
        ],
        pageParams: current.commentsHasMore ? pages.pageParams : [undefined],
      });
    },
    queryFn: ({ pageParam, signal }) => {
      if (pageParam === undefined)
        return firstPage(
          cache.getQueryData<LinearIssue>(["linear-issue", key[1]]) ?? issue,
        );
      return host.call<LinearCommentPage>(
        "linear_comments",
        {
          ...key[1],
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        { signal, priority: "background" },
      );
    },
    getNextPageParam: (page) =>
      page.hasMore ? (page.cursor ?? undefined) : undefined,
    // The issue detail already refreshes page one. Once more pages are opened,
    // refresh only that finite set of pages using the provider's current cursors.
    enabled: (entry) => (entry.state.data?.pages.length ?? 1) > 1,
    staleTime: 30_000,
    refetchInterval: (entry) =>
      (entry.state.data?.pages.length ?? 1) > 1 ? 30_000 : false,
  });
  const changes = useQuery<LinearCommentChanges>({
    queryKey: linearCommentChangesKey(issue),
    queryFn: async () => ({}),
    initialData: {},
    enabled: false,
  });
  useEffect(() => {
    cache.setQueryData<InfiniteData<LinearCommentPage, string | undefined>>(
      key,
      (current) => {
        if (!current) return current;
        return {
          pages: [
            firstPage(issue),
            ...(issue.commentsHasMore ? current.pages.slice(1) : []),
          ],
          pageParams: [
            undefined,
            ...(issue.commentsHasMore ? current.pageParams.slice(1) : []),
          ],
        };
      },
    );
  }, [cache, issue, key]);
  useEffect(() => {
    cache.setQueryData<LinearCommentChanges>(
      linearCommentChangesKey(key[1]),
      (current) =>
        current
          ? reconcileLinearCommentChanges(query.data.pages, current)
          : current,
    );
  }, [cache, key, query.data]);
  return {
    ...query,
    comments: displayedLinearComments(query.data.pages, changes.data),
  };
}
