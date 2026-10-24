import { OperationError } from "../shared/errors";

export class WriteGuardError extends OperationError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

/** Keep settled failures: an ambiguous write must not be replayed automatically. */
export function createWriteGuard<T = unknown>(
  limit = 256,
  error = (message: string, code = "unavailable") =>
    new WriteGuardError(message, code),
) {
  const requests = new Map<
    string,
    { payload: string; promise: Promise<T>; settled: boolean }
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
      return previous.promise;
    }
    if (requests.size >= limit) {
      const removable = [...requests].find(([, value]) => value.settled);
      if (!removable)
        return Promise.reject(
          error("Changes are still being processed. Wait for them to finish."),
        );
      requests.delete(removable[0]);
    }
    const entry = {
      payload: key,
      promise: Promise.resolve().then(write),
      settled: false,
    };
    requests.set(requestId, entry);
    void entry.promise.then(
      () => {
        entry.settled = true;
      },
      () => {
        entry.settled = true;
      },
    );
    return entry.promise;
  };
}
