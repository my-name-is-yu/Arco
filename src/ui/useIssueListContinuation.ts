import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";

const autoPageLimit = 3;
const prefetchDistance = 200;

// Empty GitHub pages can contain only PRs. Continue through a few of them, but
// leave a manual action instead of scanning the entire account automatically.
export function useIssueListContinuation({
  listRef,
  scope,
  enabled,
  hasNextPage,
  isFetching,
  isError,
  pageCount,
  loadNext,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  scope: string;
  enabled: boolean;
  hasNextPage: boolean;
  isFetching: boolean;
  isError: boolean;
  pageCount: number;
  loadNext: () => Promise<{ isError: boolean }>;
}) {
  const demand = useRef({
    remaining: autoPageLimit,
    inFlight: false,
    failed: false,
    scrollTop: 0,
  });
  const [completed, setCompleted] = useState(0);
  useLayoutEffect(() => {
    demand.current = {
      remaining: autoPageLimit,
      inFlight: false,
      failed: false,
      scrollTop: listRef.current?.scrollTop ?? 0,
    };
  }, [scope, listRef]);

  const fetchNext = useCallback(() => {
    const current = demand.current;
    if (!hasNextPage || isFetching || current.inFlight) return;
    current.inFlight = true;
    const settle = (failed: boolean) => {
      current.inFlight = false;
      current.failed = failed;
      setCompleted((value) => value + 1);
    };
    void loadNext().then(
      (result) => settle(result.isError),
      () => settle(true),
    );
  }, [hasNextPage, isFetching, loadNext]);

  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) return;
    const check = () => {
      const current = demand.current;
      if (
        !hasNextPage ||
        isFetching ||
        isError ||
        current.failed ||
        current.inFlight ||
        current.remaining === 0 ||
        list.clientHeight === 0 ||
        list.getClientRects().length === 0 ||
        list.scrollHeight - list.scrollTop - list.clientHeight >
          prefetchDistance
      )
        return;
      current.remaining -= 1;
      fetchNext();
    };
    const onScroll = () => {
      const current = demand.current;
      if (list.scrollTop !== current.scrollTop) {
        current.remaining = autoPageLimit;
        current.scrollTop = list.scrollTop;
      }
      check();
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    const resize = new ResizeObserver(check);
    resize.observe(list);
    check();
    return () => {
      list.removeEventListener("scroll", onScroll);
      resize.disconnect();
    };
  }, [
    listRef,
    enabled,
    hasNextPage,
    isFetching,
    isError,
    pageCount,
    completed,
    fetchNext,
  ]);

  return useCallback(() => {
    demand.current.remaining = autoPageLimit;
    demand.current.failed = false;
    fetchNext();
  }, [fetchNext]);
}
