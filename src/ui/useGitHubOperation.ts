import { useQueryClient } from "@tanstack/react-query";
import type { ArcoHost, Comment, IssueRef } from "../shared/contracts";
import { useCommandSession, useSessionState } from "./session-state";

// Shared request bookkeeping; the operation schemas and service semantics remain explicit at each caller.
export function useGitHubOperation(
  host: ArcoHost,
  scope: readonly (string | number)[],
  issue?: IssueRef,
) {
  const client = useQueryClient();
  const { busy, setBusy, lock, requests } = useCommandSession(host, "github");
  const [outcome, setOutcome] = useSessionState<{
    error: string | null;
    saved: boolean;
  }>(host, `github:operation:${JSON.stringify(scope)}`, {
    error: null,
    saved: false,
  });
  const run = async <T>(
    name: string,
    args: Record<string, unknown>,
    after?: (result: T) => void,
  ): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setOutcome({ error: null, saved: false });
    const key = JSON.stringify([name, args]);
    const requestId = requests.get(key) ?? crypto.randomUUID();
    requests.set(key, requestId);
    const reaction =
      name === "arco_add_reaction" || name === "arco_remove_reaction";
    const reactionKey = [
      "github",
      "reactions",
      args.repo,
      args.number,
      args.commentId,
    ];
    const refresh = async () => {
      if (reaction) {
        await client.invalidateQueries({ queryKey: reactionKey, exact: true });
        return;
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ["issues"] }),
        client.invalidateQueries({ queryKey: ["metadata"] }),
        client.invalidateQueries({ queryKey: ["github"] }),
        ...(issue
          ? [
              client.invalidateQueries({
                queryKey: ["issue", issue.repo, issue.number],
              }),
            ]
          : []),
      ]);
    };
    try {
      const result = await host.call<T>(name, { ...args, requestId });
      requests.delete(key);
      if (
        issue &&
        (name === "arco_edit_comment" || name === "arco_delete_comment")
      ) {
        const changed = (result as { changedComment?: Comment }).changedComment;
        client.setQueryData<Comment[]>(
          ["github", "comment-posts", issue.repo, issue.number],
          (old = []) => {
            if (!changed)
              return old.filter(
                (comment) => comment.databaseId !== args.commentId,
              );
            return old.some((comment) => comment.id === changed.id)
              ? old.map((comment) =>
                  comment.id === changed.id ? changed : comment,
                )
              : [...old, changed];
          },
        );
      }
      after?.(result);
      await refresh();
      setOutcome({ error: null, saved: true });
      return true;
    } catch (failure) {
      setOutcome({
        error: failure instanceof Error ? failure.message : String(failure),
        saved: false,
      });
      if (reaction)
        await client.invalidateQueries({ queryKey: reactionKey, exact: true });
      else {
        await client.invalidateQueries({ queryKey: ["github"] });
        if (issue)
          await client.invalidateQueries({
            queryKey: ["issue", issue.repo, issue.number],
          });
      }
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { busy, ...outcome, run };
}
