import {
  useGitHubAuthScope,
  useGitHubCall,
  githubSessionKey,
  isGitHubAuthScope,
} from "./github-auth";
import { useQueryClient } from "@tanstack/react-query";
import type { ArcoHost, Comment, IssueRef } from "../shared/contracts";
import { useCommandSession, useSessionState } from "./session-state";

export function useGitHubOperation(
  host: ArcoHost,
  scope: readonly (string | number)[],
  issue?: IssueRef,
) {
  const client = useQueryClient();
  const authScope = useGitHubAuthScope();
  const call = useGitHubCall(host);
  const commands = useCommandSession(host, "github", authScope);
  const [error, setError] = useSessionState<string | null>(
    host,
    githubSessionKey(authScope, `github:operation:${JSON.stringify(scope)}`),
    null,
  );
  const run = async <T>(
    name: string,
    args: Record<string, unknown>,
    after?: (result: T) => void,
  ): Promise<boolean> => {
    if (commands.lock.current) return false;
    commands.lock.current = true;
    commands.setBusy(true);
    setError(null);
    const key = JSON.stringify([name, args]);
    const requestId = commands.requests.get(key) ?? crypto.randomUUID();
    commands.requests.set(key, requestId);
    const reaction =
      name === "arco_add_reaction" || name === "arco_remove_reaction";
    const reactionKey = [
      "github",
      "reactions",
      args.repo,
      args.number,
      args.commentId,
      authScope,
    ];
    const refresh = async () => {
      if (reaction) {
        await client.invalidateQueries({ queryKey: reactionKey, exact: true });
        return;
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ["issues"] }),
        client.invalidateQueries({ queryKey: ["issue-set"] }),
        client.invalidateQueries({ queryKey: ["metadata"] }),
        client.invalidateQueries({ queryKey: ["github"] }),
        ...(issue
          ? [
              client.invalidateQueries({
                queryKey: ["issue", issue.repo, issue.number, authScope],
              }),
            ]
          : []),
      ]);
    };
    try {
      const result = await call<T>(name, { ...args, requestId });
      if (
        issue &&
        (name === "arco_edit_comment" || name === "arco_delete_comment")
      ) {
        const changed = (result as { changedComment?: Comment }).changedComment;
        client.setQueryData<Comment[]>(
          ["github", "comment-posts", issue.repo, issue.number, authScope],
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
      if (!isGitHubAuthScope(client, authScope)) return true;
      after?.(result);
      await refresh();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      if (reaction) {
        await client.invalidateQueries({ queryKey: reactionKey, exact: true });
        return false;
      }
      await client.invalidateQueries({ queryKey: ["github"] });
      if (issue)
        await client.invalidateQueries({
          queryKey: ["issue", issue.repo, issue.number, authScope],
        });
      return false;
    } finally {
      commands.lock.current = false;
      commands.setBusy(false);
    }
  };
  return { busy: commands.busy, error, run };
}
