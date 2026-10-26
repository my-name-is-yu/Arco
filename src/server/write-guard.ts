import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { OperationError } from "../shared/errors";

type WriteAuthorization = {
  scope: string;
  read: () => Promise<string>;
  error: (message: string, code: string) => OperationError;
};

type WriteProgress = {
  confirmed: boolean;
  uncertain: boolean;
  pending: number;
  parent?: WriteProgress;
  authorization?: WriteAuthorization;
};
const progressStorage = new AsyncLocalStorage<WriteProgress>();

async function readAuthorizationScope(
  read: WriteAuthorization["read"],
  error: WriteAuthorization["error"],
) {
  try {
    const scope = await read();
    if (typeof scope !== "string" || !scope.trim())
      throw error(
        "Could not verify the provider sign-in. Reconnect and refresh.",
        "auth",
      );
    return scope;
  } catch (failure) {
    if (failure instanceof OperationError) throw failure;
    throw error(
      "Could not verify the provider sign-in. Reconnect and refresh.",
      "auth",
    );
  }
}

async function validateAuthorization(progress: WriteProgress | undefined) {
  for (let current = progress; current; current = current.parent) {
    const authorization = current.authorization;
    if (!authorization) continue;
    if (
      (await readAuthorizationScope(
        authorization.read,
        authorization.error,
      )) !== authorization.scope
    )
      throw authorization.error(
        "This requestId belongs to an earlier provider sign-in. Check the provider and refresh without repeating the change.",
        "conflict",
      );
  }
}

function hasAuthorization(progress: WriteProgress | undefined) {
  for (let current = progress; current; current = current.parent)
    if (current.authorization) return true;
  return false;
}

function authorizationBinding(progress: WriteProgress) {
  const scopes = new Set<string>();
  for (
    let current: WriteProgress | undefined = progress;
    current;
    current = current.parent
  )
    if (current.authorization) scopes.add(current.authorization.scope);
  const own = progress.authorization?.scope;
  if (own !== undefined) scopes.delete(own);
  return own !== undefined || scopes.size
    ? createHash("sha256")
        .update(JSON.stringify([own ?? null, [...scopes].sort()]))
        .digest("hex")
    : undefined;
}

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
    if (hasAuthorization(progress)) await validateAuthorization(progress);
    try {
      const result = await write();
      mark("confirmed");
      return result;
    } catch (error) {
      if (!rejected(error)) mark("uncertain");
      throw error;
    } finally {
      if (hasAuthorization(progress)) await validateAuthorization(progress);
    }
  } finally {
    for (let scope = progress; scope; scope = scope.parent) scope.pending -= 1;
  }
}

export class WriteGuardError extends OperationError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}

/**
 * Retain completed or ambiguous writes; allow definite preflight failures to retry.
 * readScope must freshly read a private authorization generation, not a connection alias.
 */
export function createWriteGuard<T = unknown, P = unknown>(
  limit = 256,
  error = (message: string, code = "unavailable") =>
    new WriteGuardError(message, code),
  readScope?: (payload: P) => Promise<string>,
) {
  const requests = new Map<
    string,
    {
      payload: string;
      promise: Promise<T>;
      settled: boolean;
      retryable: boolean;
      progress: WriteProgress;
      authorizationScope?: string;
    }
  >();
  // Retain small request bindings for this process after releasing full results.
  const retired = new Map<
    string,
    { payload: string; retryable: boolean; authorizationScope?: string }
  >();
  const run = (
    requestId: string,
    payload: P,
    write: () => Promise<T>,
    progress: WriteProgress,
  ): Promise<T> => {
    const key = createHash("sha256")
      .update(JSON.stringify(payload) ?? "")
      .digest("hex");
    const binding = authorizationBinding(progress);
    const previous = requests.get(requestId);
    const retained = previous ?? retired.get(requestId);
    if (retained) {
      if (retained.authorizationScope !== binding)
        return Promise.reject(
          error(
            "This requestId belongs to an earlier provider sign-in. Check the provider and refresh without repeating the change.",
            "conflict",
          ),
        );
      if (retained.payload !== key)
        return Promise.reject(
          error(
            "This requestId was already used for a different change.",
            "conflict",
          ),
        );
      if (!retained.retryable) {
        if (!previous)
          return Promise.reject(
            error(
              "This request's result is no longer retained. Check the provider and refresh without repeating the change.",
              "uncertain",
            ),
          );
        return hasAuthorization(previous.progress)
          ? previous.promise.finally(() =>
              validateAuthorization(previous.progress),
            )
          : previous.promise;
      }
    }
    if (!previous && requests.size >= limit) {
      const removable = [...requests].find(
        ([, value]) => value.settled && value.progress.pending === 0,
      );
      if (!removable)
        return Promise.reject(
          error("Changes are still being processed. Wait for them to finish."),
        );
      retired.set(removable[0], {
        payload: removable[1].payload,
        retryable: removable[1].retryable,
        authorizationScope: removable[1].authorizationScope,
      });
      requests.delete(removable[0]);
    }
    const entry = {
      payload: key,
      promise: Promise.resolve().then(() =>
        progressStorage.run(progress, () =>
          hasAuthorization(progress)
            ? validateAuthorization(progress).then(write)
            : write(),
        ),
      ),
      settled: false,
      retryable: false,
      progress,
      authorizationScope: binding,
    };
    requests.set(requestId, entry);
    retired.delete(requestId);
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
  return (
    requestId: string,
    payload: P,
    write: () => Promise<T>,
  ): Promise<T> => {
    const progress: WriteProgress = {
      confirmed: false,
      uncertain: false,
      pending: 0,
      parent: progressStorage.getStore(),
    };
    if (!readScope && !hasAuthorization(progress))
      return run(requestId, payload, write, progress);
    return (async () => {
      if (readScope) {
        const read = () => readScope(payload);
        progress.authorization = {
          scope: await readAuthorizationScope(read, error),
          read,
          error,
        };
      }
      try {
        return await run(requestId, payload, write, progress);
      } finally {
        await validateAuthorization(progress);
      }
    })();
  };
}
