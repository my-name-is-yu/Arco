type Continuation = string | number | null | undefined;

export function pageContinuationError(
  hasMore: boolean,
  continuation: Continuation,
  subject: string,
): Error | null {
  if (
    hasMore &&
    !(
      (typeof continuation === "string" && continuation.length > 0) ||
      (typeof continuation === "number" &&
        Number.isInteger(continuation) &&
        continuation > 0)
    )
  )
    return new Error(
      `${subject} returned no valid continuation. Refresh before loading more.`,
    );
  return null;
}

export function requirePageContinuation<T extends { hasMore: boolean }>(
  page: T,
  continuation: Continuation,
  subject: string,
): T {
  const error = pageContinuationError(page.hasMore, continuation, subject);
  if (error) throw error;
  return page;
}
