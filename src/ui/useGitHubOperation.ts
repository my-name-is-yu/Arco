import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ArcoHost, IssueRef } from "../shared/contracts";

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
    try {
      const result = await host.call<T>(name, { ...args, requestId });
      requests.current.delete(key);
      after?.(result);
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
      setSaved(true);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      await client.invalidateQueries({ queryKey: ["github"] });
      if (issue)
        await client.invalidateQueries({
          queryKey: ["issue", issue.repo, issue.number],
        });
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { busy, error, saved, run };
}
