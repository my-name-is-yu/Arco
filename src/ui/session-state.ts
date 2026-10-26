import {
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ArcoHost } from "../shared/contracts";
import type { NativeIssueTarget } from "../shared/launch";

export const githubSessionKey = (scope: string, key: string) =>
  `${key}:${scope}`;

type Cell<T> = {
  value: T;
  listeners: Set<() => void>;
  subscribe: (listener: () => void) => () => void;
  set: Dispatch<SetStateAction<T>>;
};
const sessions = new WeakMap<ArcoHost, Map<string, unknown>>();
export function sessionValue<T>(
  host: ArcoHost,
  key: string,
  create: () => T,
): T {
  const existing = sessions.get(host);
  const session = existing ?? new Map<string, unknown>();
  if (!existing) sessions.set(host, session);
  if (!session.has(key)) session.set(key, create());
  return session.get(key) as T;
}
function stateCell<T>(
  host: ArcoHost,
  key: string,
  initial: T | (() => T),
): Cell<T> {
  return sessionValue(host, `state:${key}`, () => {
    const cell: Cell<T> = {
      value: typeof initial === "function" ? (initial as () => T)() : initial,
      listeners: new Set(),
      subscribe(listener) {
        cell.listeners.add(listener);
        return () => {
          cell.listeners.delete(listener);
        };
      },
      set(update) {
        const next =
          typeof update === "function"
            ? (update as (value: T) => T)(cell.value)
            : update;
        if (Object.is(next, cell.value)) return;
        cell.value = next;
        cell.listeners.forEach((listener) => listener());
      },
    };
    return cell;
  });
}
// UI sessions outlive provider views; server records remain in QueryClient.
export function useSessionState<T>(
  host: ArcoHost,
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const cell = stateCell(host, key, initial);
  const value = useSyncExternalStore(cell.subscribe, () => cell.value);
  return [value, cell.set];
}
export function useSessionRef<T>(host: ArcoHost, key: string, initial: T) {
  return sessionValue(host, `ref:${key}`, () => ({ current: initial }));
}
function setSessionState<T>(host: ArcoHost, key: string, value: T) {
  stateCell(host, key, value).set(value);
}
export function selectPresentedIssue(
  host: ArcoHost,
  target: NativeIssueTarget,
  githubAuthScope?: string,
) {
  setSessionState(host, "issue-set:opened", target);
  setSessionState(host, "active-source", target.source);
  if (target.source === "github") {
    if (!githubAuthScope) return;
    setSessionState(
      host,
      githubSessionKey(githubAuthScope, "github:repoOverride"),
      target.repo,
    );
    setSessionState(
      host,
      githubSessionKey(githubAuthScope, "github:selected"),
      {
        repo: target.repo,
        number: target.number,
      },
    );
    setSessionState(
      host,
      githubSessionKey(githubAuthScope, "github:showDetail"),
      true,
    );
  } else {
    setSessionState(host, "linear:teamOverride", target.teamId);
    setSessionState(host, "linear:selected", {
      connectionId: target.connectionId,
      workspaceId: target.workspaceId,
      teamId: target.teamId,
      issueId: target.issueId,
    });
    setSessionState(host, "linear:showDetail", true);
  }
}
export function useCommandSession(
  host: ArcoHost,
  source: "github" | "linear",
  scope?: string,
) {
  const owner = scope ? `${source}:${scope}` : source;
  const [busy, setBusy] = useSessionState(host, `${owner}:mutationBusy`, false);
  const lock = useSessionRef(host, `${owner}:mutationLock`, false);
  const requests = getCommandRequests(host, source);
  return { busy, setBusy, lock, requests };
}
export function getCommandRequests(
  host: ArcoHost,
  source: "github" | "linear",
) {
  // An unresolved write keeps its request ID across account changes.
  return sessionValue(
    host,
    `${source}:requests`,
    () => new Map<string, string>(),
  );
}
