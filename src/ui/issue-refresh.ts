import { useEffect, useRef } from "react";

// An automatic infinite-query refresh would reread every opened page.
// Keep larger lists and failed reads under explicit user control.
export function canAutoRefreshIssueList(query: {
  data?: { pages: readonly unknown[] };
  status: string;
}) {
  return query.data?.pages.length === 1 && query.status !== "error";
}

export function useIssueRefreshOnReturn(
  visible: boolean,
  eligible: boolean,
  {
    isStale,
    refetch,
  }: {
    isStale: boolean;
    refetch: (options: { cancelRefetch: false }) => Promise<unknown>;
  },
) {
  const wasVisible = useRef(visible);
  useEffect(() => {
    const returning = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (returning && eligible && isStale)
      void refetch({ cancelRefetch: false });
  }, [visible, eligible, isStale, refetch]);
}
