import { randomUUID } from "node:crypto";

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
