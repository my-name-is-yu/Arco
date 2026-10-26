import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { ArcoHost, Connection } from "../shared/contracts";
import { ToolCallError } from "../shared/errors";
import { WorkspaceSkeleton } from "./LoadingSkeleton";
import { AsyncState } from "./AsyncState";
import { seedPresentationCache } from "./presentation-cache";
import { getCommandRequests } from "./session-state";

export { githubSessionKey } from "./session-state";

export const GitHubAuthScopeContext = createContext<string | null>(null);

export function useGitHubAuthScope() {
  const scope = useContext(GitHubAuthScopeContext);
  if (!scope) throw new Error("GitHub authentication scope is unavailable.");
  return scope;
}

export function isGitHubAuthScope(client: QueryClient, scope: string) {
  return (
    client.getQueryData<Connection>(["connection"])?.authGeneration === scope
  );
}

export function useGitHubCall(host: ArcoHost): ArcoHost["call"] {
  const scope = useGitHubAuthScope();
  const client = useQueryClient();
  return useCallback(
    <T,>(
      name: string,
      args: Record<string, unknown>,
      options?: Parameters<ArcoHost["call"]>[2],
    ): Promise<T> => {
      if (!isGitHubAuthScope(client, scope))
        return Promise.reject(
          new ToolCallError(
            "auth",
            "GitHub authentication changed. Check the current account before continuing.",
          ),
        );
      const { requestId, ...input } = args;
      if (typeof requestId !== "string")
        return host.call<T>(name, args, options);
      const requests = getCommandRequests(host, "github");
      const key = JSON.stringify([name, input]);
      const retainedId = requests.get(key) ?? requestId;
      requests.set(key, retainedId);
      return host
        .call<T>(name, { ...input, requestId: retainedId }, options)
        .then((result) => {
          if (name !== "arco_bulk_update" && requests.get(key) === retainedId)
            requests.delete(key);
          return result;
        });
    },
    [host, client, scope],
  );
}

export function GitHubAuthBoundary({
  host,
  children,
}: {
  host: ArcoHost;
  children: (scope: string) => ReactNode;
}) {
  const client = useQueryClient();
  const previousScope = useRef<string | undefined>(undefined);
  const connection = useQuery({
    queryKey: ["connection"],
    queryFn: async () => {
      const result = await host.call<Connection>("arco_connection", {});
      if (typeof result.authGeneration !== "string" || !result.authGeneration)
        throw new ToolCallError(
          "invalid-response",
          "Could not verify the current GitHub authentication. Reopen Arco and try again.",
        );
      seedPresentationCache(client, host, result.authGeneration);
      return result;
    },
  });
  const scope = connection.data?.authGeneration;
  useEffect(() => {
    const previous = previousScope.current;
    previousScope.current = scope;
    if (!previous || !scope || previous === scope) return;
    const owned = (key: readonly unknown[]) =>
      [
        "issue",
        "issues",
        "metadata",
        "github",
        "github-repositories",
        "source-image",
        "issue-set",
      ].includes(String(key[0])) && key.at(-1) === previous;
    void client.cancelQueries({ predicate: (query) => owned(query.queryKey) });
    client.removeQueries({ predicate: (query) => owned(query.queryKey) });
  }, [client, scope]);
  if (!connection.data?.authGeneration) {
    if (connection.isError)
      return (
        <main className="arco empty-state">
          <AsyncState kind="error">
            <h1>Could not verify GitHub authentication</h1>
            <p>{connection.error.message}</p>
            <button onClick={() => void connection.refetch()}>
              Retry GitHub authentication
            </button>
          </AsyncState>
        </main>
      );
    return <WorkspaceSkeleton mode={host.mode()} />;
  }
  return (
    <GitHubAuthScopeContext.Provider value={connection.data.authGeneration}>
      {children(connection.data.authGeneration)}
    </GitHubAuthScopeContext.Provider>
  );
}
