import { useEffect } from "react";
import { useGitHubAuthScope, useGitHubCall } from "./github-auth";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  replaceEqualDeep,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  ArcoHost,
  Comment,
  CommentPage,
  IssueDetail,
  IssueRef,
} from "../shared/contracts";
import {
  pageContinuationError,
  requirePageContinuation,
} from "./page-continuation";
import { githubIssueKey } from "./github-issue-key";
export const commentsKey = (issue: IssueRef, scope: string) =>
  ["github", "comments", issue.repo, issue.number, scope] as const;
export const commentPostsKey = (issue: IssueRef, scope: string) =>
  ["github", "comment-posts", issue.repo, issue.number, scope] as const;
const firstCommentPage = (issue: IssueDetail): CommentPage => ({
  comments: issue.comments,
  hasMore: issue.commentsHasMore,
  nextPage: issue.commentsNextPage,
});

export function mergeCommentPages(
  pages: CommentPage[],
  posted: Comment[],
): Comment[] {
  const comments = new Map<string, Comment>();
  for (const comment of [
    ...pages.flatMap((page) => page.comments),
    ...posted,
  ]) {
    const previous = comments.get(comment.id);
    if (
      !previous ||
      Date.parse(comment.updatedAt) >= Date.parse(previous.updatedAt)
    )
      comments.set(comment.id, comment);
  }
  return [...comments.values()];
}

export function useGitHubComments(host: ArcoHost, issue: IssueDetail) {
  const client = useQueryClient();
  const authScope = useGitHubAuthScope();
  const call = useGitHubCall(host);
  const firstPage = firstCommentPage(issue);
  const firstPageError = pageContinuationError(
    firstPage.hasMore,
    firstPage.nextPage,
    "GitHub comments",
  );
  const comments = useInfiniteQuery({
    queryKey: commentsKey(issue, authScope),
    initialPageParam: 1,
    initialData: { pages: [firstPage], pageParams: [1] },
    structuralSharing: (previous, incoming) => {
      const pages = incoming as InfiniteData<CommentPage, number>;
      const current = client.getQueryData<IssueDetail>(
        githubIssueKey(issue, authScope),
      );
      if (!current) return replaceEqualDeep(previous, pages);
      // A continuation can finish after a newer detail refresh. Its captured
      // first page must never replace the current issue's first page.
      return replaceEqualDeep(previous, {
        pages: [
          firstCommentPage(current),
          ...(current.commentsHasMore ? pages.pages.slice(1) : []),
        ],
        pageParams: current.commentsHasMore ? pages.pageParams : [1],
      });
    },
    staleTime: Infinity,
    refetchInterval: 30_000,
    queryFn: async ({ pageParam, signal }) => {
      // The detail query refreshes the first page. Only explicitly loaded
      // continuation pages need additional provider reads during refresh.
      if (pageParam === 1) {
        const page = firstCommentPage(
          client.getQueryData<IssueDetail>(githubIssueKey(issue, authScope)) ??
            issue,
        );
        return requirePageContinuation(page, page.nextPage, "GitHub comments");
      }
      const page = await call<CommentPage>(
        "arco_comments",
        {
          repo: issue.repo,
          number: issue.number,
          page: pageParam,
        },
        // These pages were explicitly opened. Keep the background slot free
        // for the first-page refresh while a continuation is still pending.
        { signal, priority: "interactive" },
      );
      return requirePageContinuation(page, page.nextPage, "GitHub comments");
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextPage : undefined),
  });
  const posted = useQuery<Comment[]>({
    queryKey: commentPostsKey(issue, authScope),
    queryFn: () => [],
    initialData: [],
    enabled: false,
  });
  useEffect(() => {
    client.setQueryData<InfiniteData<CommentPage, number>>(
      commentsKey(issue, authScope),
      (previous) => ({
        pages: [
          firstCommentPage(issue),
          ...(issue.commentsHasMore ? (previous?.pages.slice(1) ?? []) : []),
        ],
        pageParams: issue.commentsHasMore ? (previous?.pageParams ?? [1]) : [1],
      }),
    );
  }, [client, issue, authScope]);
  useEffect(() => {
    const loaded = new Map(
      comments.data.pages.flatMap((page) =>
        page.comments.map((comment) => [comment.id, comment] as const),
      ),
    );
    const confirmed = (comment: Comment) => {
      const native = loaded.get(comment.id);
      return (
        native !== undefined &&
        (Date.parse(native.updatedAt) > Date.parse(comment.updatedAt) ||
          (native.updatedAt === comment.updatedAt &&
            native.body === comment.body))
      );
    };
    client.setQueryData<Comment[]>(
      commentPostsKey(issue, authScope),
      (previous) =>
        previous?.some(confirmed)
          ? previous.filter((comment) => !confirmed(comment))
          : previous,
    );
  }, [client, comments.data, issue, authScope]);
  const visibleComments = mergeCommentPages(comments.data.pages, posted.data);
  return {
    comments: visibleComments,
    error: firstPageError ?? comments.error,
    isError: firstPageError !== null || comments.isError,
    hasNextPage: firstPageError === null && comments.hasNextPage,
    isFetching: comments.isFetching,
    isFetchingNextPage: comments.isFetchingNextPage,
    fetchNextPage: comments.fetchNextPage,
  };
}
