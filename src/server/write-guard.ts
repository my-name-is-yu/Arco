import { AsyncLocalStorage } from "node:async_hooks";
import { OperationError } from "../shared/errors";

type WriteProgress = {
  confirmed: boolean;
  uncertain: boolean;
  pending: number;
  parent?: WriteProgress;
};
const progressStorage = new AsyncLocalStorage<WriteProgress>();

export function getWriteProgress() {
  const progress = progressStorage.getStore();
  return {
    confirmed: progress?.confirmed ?? false,
    uncertain: Boolean(
      progress && (progress.uncertain || progress.pending > 0),
    ),
  };
}

/** Mark the actual mutation boundary, leaving failed preflight reads retryable. */
export async function trackWrite<T>(
  write: () => Promise<T>,
  rejected: (error: unknown) => boolean = () => false,
): Promise<T> {
  const progress = progressStorage.getStore();
  for (let scope = progress; scope; scope = scope.parent) scope.pending += 1;
  const mark = (kind: "confirmed" | "uncertain") => {
    for (let scope = progress; scope; scope = scope.parent) scope[kind] = true;
  };
  try {
    const result = await write();
    mark("confirmed");
    return result;
  } catch (error) {
    if (!rejected(error)) mark("uncertain");
    throw error;
  } finally {
    for (let scope = progress; scope; scope = scope.parent) scope.pending -= 1;
  }
}

export class WriteGuardError extends OperationError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

/** Retain completed or ambiguous writes; allow definite preflight failures to retry. */
export function createWriteGuard<T = unknown>(
  limit = 256,
  error = (message: string, code = "unavailable") =>
    new WriteGuardError(message, code),
) {
  const requests = new Map<
    string,
    {
      payload: string;
      promise: Promise<T>;
      settled: boolean;
      retryable: boolean;
      progress: WriteProgress;
    }
  >();
  return (
    requestId: string,
    payload: unknown,
    write: () => Promise<T>,
  ): Promise<T> => {
    const key = JSON.stringify(payload);
    const previous = requests.get(requestId);
    if (previous) {
      if (previous.payload !== key)
        return Promise.reject(
          error(
            "This requestId was already used for a different change.",
            "conflict",
          ),
        );
      if (!previous.retryable) return previous.promise;
    }
    if (!previous && requests.size >= limit) {
      const removable = [...requests].find(
        ([, value]) => value.settled && value.progress.pending === 0,
      );
      if (!removable)
        return Promise.reject(
          error("Changes are still being processed. Wait for them to finish."),
        );
      requests.delete(removable[0]);
    }
    const progress: WriteProgress = {
      confirmed: false,
      uncertain: false,
      pending: 0,
      parent: progressStorage.getStore(),
    };
    const entry = {
      payload: key,
      promise: Promise.resolve().then(() =>
        progressStorage.run(progress, write),
      ),
      settled: false,
      retryable: false,
      progress,
    };
    requests.set(requestId, entry);
    void entry.promise.then(
      () => {
        entry.settled = true;
      },
      (failure: unknown) => {
        entry.settled = true;
        if (
          !progress.confirmed &&
          !progress.uncertain &&
          progress.pending === 0 &&
          failure instanceof OperationError &&
          !["uncertain", "refresh", "not-applied"].includes(failure.code)
        )
          entry.retryable = true;
      },
    );
    return entry.promise;
  };
}
