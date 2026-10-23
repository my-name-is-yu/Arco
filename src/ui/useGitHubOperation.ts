import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ArcoHost, Comment, IssueRef } from "../shared/contracts";

const pendingByHost = new WeakMap<ArcoHost, Map<string, string>>();
function pendingFor(host: ArcoHost) {
  let pending = pendingByHost.get(host);
  if (!pending) {
    pending = new Map();
    pendingByHost.set(host, pending);
  }
  return pending;
}

// Shared request bookkeeping; the operation schemas and service semantics remain explicit at each caller.
export function useGitHubOperation(host: ArcoHost, issue?: IssueRef) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const requests = useRef(pendingFor(host));
  const run = async <T>(
    name: string,
    args: Record<string, unknown>,
    after?: (result: T) => void,
  ): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    const key = JSON.stringify([name, args]);
    const requestId = requests.current.get(key) ?? crypto.randomUUID();
    requests.current.set(key, requestId);
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
      requests.current.delete(key);
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
      setSaved(true);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
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
  return { busy, error, saved, run };
}
