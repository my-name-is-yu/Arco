import { useEffect } from "react";
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
const issueKey = (issue: IssueRef) =>
  ["issue", issue.repo, issue.number] as const;
export const commentsKey = (issue: IssueRef) =>
  ["github", "comments", issue.repo, issue.number] as const;
export const commentPostsKey = (issue: IssueRef) =>
  ["github", "comment-posts", issue.repo, issue.number] as const;
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
  const firstPage = firstCommentPage(issue);
  const firstPageError = pageContinuationError(
    firstPage.hasMore,
    firstPage.nextPage,
    "GitHub comments",
  );
  const comments = useInfiniteQuery({
    queryKey: commentsKey(issue),
    initialPageParam: 1,
    initialData: { pages: [firstPage], pageParams: [1] },
    structuralSharing: (previous, incoming) => {
      const pages = incoming as InfiniteData<CommentPage, number>;
      const current = client.getQueryData<IssueDetail>(issueKey(issue));
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
          client.getQueryData<IssueDetail>(issueKey(issue)) ?? issue,
        );
        return requirePageContinuation(page, page.nextPage, "GitHub comments");
      }
      const page = await host.call<CommentPage>(
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
    queryKey: commentPostsKey(issue),
    queryFn: () => [],
    initialData: [],
    enabled: false,
  });
  useEffect(() => {
    client.setQueryData<InfiniteData<CommentPage, number>>(
      commentsKey(issue),
      (previous) => ({
        pages: [
          firstCommentPage(issue),
          ...(issue.commentsHasMore ? (previous?.pages.slice(1) ?? []) : []),
        ],
        pageParams: issue.commentsHasMore ? (previous?.pageParams ?? [1]) : [1],
      }),
    );
  }, [client, issue]);
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
    client.setQueryData<Comment[]>(commentPostsKey(issue), (previous) =>
      previous?.some(confirmed)
        ? previous.filter((comment) => !confirmed(comment))
        : previous,
    );
  }, [client, comments.data, issue]);
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
