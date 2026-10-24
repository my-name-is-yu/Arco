import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ArcoHost, DisplayMode } from "../shared/contracts";
import { useSessionRef } from "./session-state";

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
  searchRef,
}: {
  rows: T[];
  activeKey: string | null;
  keyForRow: (row: T) => string;
  onSelect: (row: T) => void;
  onClose: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="button"]',
          ))
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") onClose();
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const index = rows.findIndex((row) => keyForRow(row) === activeKey);
        const next =
          rows[
            Math.max(
              0,
              Math.min(rows.length - 1, index + (event.key === "j" ? 1 : -1)),
            )
          ];
        if (next) onSelect(next);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [rows, activeKey, keyForRow, onSelect, onClose, searchRef]);
}
