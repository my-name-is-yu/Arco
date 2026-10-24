import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ArcoHost } from "../shared/contracts";
import { sessionValue } from "./session-state";
import { seedPresentationCache } from "./presentation-cache";
function hostView(host: ArcoHost) {
  const read = () => ({
    launch: host.launch(),
    mode: host.mode(),
    sharedIssue: host.sharedIssue(),
  });
  return sessionValue(host, "host-view", () => {
    let snapshot = read();
    const listeners = new Set<() => void>();
    return {
      get: () => snapshot,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      update() {
        snapshot = read();
        listeners.forEach((listener) => listener());
      },
    };
  });
}
type View = ReturnType<ReturnType<typeof hostView>["get"]>;
const HostViewContext = createContext<View | null>(null);
export function HostProvider({
  host,
  children,
}: {
  host: ArcoHost;
  children: ReactNode;
}) {
  const store = useMemo(() => hostView(host), [host]);
  const client = useQueryClient();
  const view = useSyncExternalStore(store.subscribe, store.get);
  useEffect(() => {
    const unsubscribe = host.subscribe((event) => {
      if (event !== "data") {
        seedPresentationCache(client, host);
        store.update();
      } else
        void client.invalidateQueries(
          {
            predicate: (entry) => {
              const key = String(entry.queryKey[0]);
              return (
                ["issue", "issues", "issue-set", "metadata", "github"].includes(
                  key,
                ) ||
                [
                  "linear-scopes",
                  "linear-templates",
                  "linear-issue",
                  "linear-issues",
                  "linear-metadata",
                  "linear-comments",
                ].includes(key)
              );
            },
          },
          { cancelRefetch: false },
        );
    });
    seedPresentationCache(client, host);
    store.update();
    return unsubscribe;
  }, [host, client, store]);
  return (
    <HostViewContext.Provider value={view}>{children}</HostViewContext.Provider>
  );
}
export function useHostView() {
  const view = useContext(HostViewContext);
  if (!view) throw new Error("Arco host view is unavailable.");
  return view;
}
