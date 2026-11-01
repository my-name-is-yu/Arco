import { useLayoutEffect, useRef, type RefObject } from "react";
import type { ArcoHost, DisplayMode } from "../shared/contracts";
import { useSessionRef } from "./session-state";
import { useIssueShortcuts, useShortcuts } from "./keyboard-shortcuts";

export function useListScroll({
  host,
  sessionKey,
  listRef,
  scope,
  mode,
  ready,
}: {
  host: ArcoHost;
  sessionKey: string;
  listRef: RefObject<HTMLDivElement | null>;
  scope: string;
  mode: DisplayMode;
  ready: boolean;
}) {
  const positions = useSessionRef(host, sessionKey, new Map<string, number>());
  const restored = useRef<string | null>(null);
  const view = `${mode}:${scope}`;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !ready) {
      restored.current = null;
      return;
    }
    if (restored.current !== view) {
      list.scrollTop = positions.current.get(scope) ?? 0;
      restored.current = view;
    }
  }, [listRef, ready, view, scope, positions]);
  return () => {
    if (listRef.current && restored.current === view)
      positions.current.set(scope, listRef.current.scrollTop);
  };
}

export function useListKeyboard<T>({
  rows,
  activeKey,
  keyForRow,
  onSelect,
  onClose,
  onGoToList,
  mode,
  listRef,
  searchRef,
  searchEnabled = true,
}: {
  rows: T[];
  activeKey: string | null;
  keyForRow: (row: T) => string;
  onSelect: (row: T) => void;
  onClose: () => void;
  onGoToList: () => void;
  mode: DisplayMode;
  listRef: RefObject<HTMLDivElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  searchEnabled?: boolean;
}) {
  const controller = useShortcuts()?.controller;
  const focusPending = () => {
    const destination = controller?.pendingFocus();
    if (mode !== "fullscreen" || !destination) return;
    const list = listRef.current;
    const workspace = list?.closest(".workspace");
    const detailPane = workspace?.querySelector<HTMLElement>(".detail-pane");
    const detail = detailPane?.querySelector<HTMLElement>(".detail-scroll");
    let element: HTMLElement | null | undefined;
    if (destination === "search") element = searchRef.current;
    else if (destination === "detail" || !list?.getClientRects().length)
      element = detail ?? detailPane;
    else {
      element = list.querySelector<HTMLElement>(".issue-row.selected");
      // An expanded inline card may still be loading its list after remount.
      if (!element && list.getAttribute("aria-busy") !== "true") element = list;
    }
    if (!element || !element.getClientRects().length) return;
    controller?.cancelFocus();
    element.focus({ preventScroll: true });
    // Keep keys inside Arco while an uncached issue's body is loading.
    if (
      element === detailPane &&
      detailPane?.getAttribute("aria-busy") === "true"
    )
      controller?.requestFocus("detail");
    if (element.matches(".issue-row"))
      element.scrollIntoView({ block: "nearest" });
  };
  useLayoutEffect(() => {
    focusPending();
  });
  const index = rows.findIndex((row) => keyForRow(row) === activeKey);
  const selectIssue = (row: T) => {
    controller?.requestFocus(
      listRef.current?.contains(document.activeElement) ? "list" : "detail",
    );
    onSelect(row);
    requestAnimationFrame(focusPending);
  };
  const move = (direction: -1 | 1) => {
    const next = activeKey === null ? rows[0] : rows[index + direction];
    if (!next || (activeKey !== null && index < 0)) return;
    selectIssue(next);
  };
  const goToList = () => {
    controller?.requestFocus("list");
    onGoToList();
    // The wide layout can already show the list without a state change.
    requestAnimationFrame(focusPending);
  };
  useIssueShortcuts(
    "workspace",
    mode === "fullscreen" ? "workspace" : "inline",
    {
      list: { run: goToList, enabled: true },
      ...(mode === "fullscreen"
        ? {
            previous: {
              run: () => move(-1),
              enabled: activeKey === null ? rows.length > 0 : index > 0,
            },
            next: {
              run: () => move(1),
              enabled:
                activeKey === null
                  ? rows.length > 0
                  : index >= 0 && index < rows.length - 1,
            },
            ...(searchEnabled
              ? {
                  search: {
                    run: () => {
                      controller?.requestFocus("search");
                      if (!searchRef.current?.getClientRects().length)
                        onClose();
                      requestAnimationFrame(focusPending);
                    },
                    enabled: true,
                  },
                }
              : {}),
          }
        : {}),
    },
  );
  return { goToList, selectIssue };
}

function saveReadingPosition(
  positions: Map<string, number>,
  issueKey: string,
  element: HTMLElement | null,
  aliasKey?: string,
) {
  if (!element?.getClientRects().length) return;
  const keys =
    aliasKey && aliasKey !== issueKey ? [aliasKey, issueKey] : [issueKey];
  for (const key of keys) {
    positions.delete(key);
    positions.set(key, element.scrollTop);
  }
  while (positions.size > 100) positions.delete(positions.keys().next().value!);
}

export function useDetailReadingPosition<
  T extends HTMLElement = HTMLDivElement,
>(host: ArcoHost, issueKey: string, ready = true, aliasKey?: string) {
  const element = useRef<T>(null);
  const contentReady = useRef(ready);
  contentReady.current = ready;
  const positions = useSessionRef(
    host,
    "detail:reading-positions",
    new Map<string, number>(),
  );
  useLayoutEffect(() => {
    const current = element.current;
    // Wait for asynchronous detail content before restoring a saved offset.
    if (!current || !ready) return;
    const readingPositions = positions.current;
    // Identity enrichment keeps the mounted panel's offset before its native key.
    current.scrollTop =
      (aliasKey ? readingPositions.get(aliasKey) : undefined) ??
      readingPositions.get(issueKey) ??
      0;
    // A fast issue switch can happen before the browser dispatches scroll.
    return () => {
      // A loading placeholder may already have clamped the DOM's scrollTop.
      if (contentReady.current)
        saveReadingPosition(readingPositions, issueKey, current, aliasKey);
    };
  }, [issueKey, positions, ready, aliasKey]);
  const save = () =>
    ready &&
    saveReadingPosition(positions.current, issueKey, element.current, aliasKey);
  return { ref: element, onScroll: save, onKeyDownCapture: save };
}
