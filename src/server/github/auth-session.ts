import { randomUUID } from "node:crypto";
import { GitHubError } from "./transport";

/** A public, memory-only scope unrelated to the private credential fingerprint. */
export function createGitHubAuthSession(identity: () => Promise<string>) {
  let credential: string | undefined;
  let generation = randomUUID();
  let pending: Promise<string> | undefined;
  return {
    current: () => generation,
    read() {
      if (pending) return pending;
      pending = Promise.resolve()
        .then(identity)
        .then(
          (next) => {
            if (next !== credential) {
              credential = next;
              generation = randomUUID();
            }
            return generation;
          },
          (error: unknown) => {
            if (credential !== undefined) {
              credential = undefined;
              generation = randomUUID();
            }
            throw error;
          },
        )
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}

export type GitHubAuthSession = ReturnType<typeof createGitHubAuthSession>;

/** Reject a completed read if its observed credential generation changed. */
export function scopedGitHubRead<Args extends unknown[], Result>(
  authSession: GitHubAuthSession,
  read: (...args: Args) => Promise<Result>,
) {
  return async (...args: Args): Promise<Result> => {
    const generation = await authSession.read();
    const result = await read(...args);
    if (generation !== (await authSession.read()))
      throw new GitHubError(
        "GitHub authentication changed while loading data. Refresh to verify the current account.",
        "auth",
      );
    return result;
  };
}
