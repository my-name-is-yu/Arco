import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ArcoHost } from "../shared/contracts";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Keyboard,
} from "@openai/apps-sdk-ui/components/Icon";
import { useSettings } from "./useSettings";
import {
  ShortcutHelpDialog,
  ShortcutKeys,
  ShortcutTooltip,
  type ShortcutHint,
} from "./ShortcutUI";

type Action = "previous" | "next" | "list" | "search";
type Scope = "workspace" | "tabs" | "inline";
type FocusDestination = "list" | "detail" | "search";
type Command = { run: () => void; enabled: boolean };
type Commands = Partial<Record<Action, Command>>;
const hints: Record<Action | "help", ShortcutHint> = {
  previous: { label: "Previous issue", keys: ["K"] },
  next: { label: "Next issue", keys: ["J"] },
  list: { label: "Go to issue list", keys: ["G", "I"], sequence: true },
  search: { label: "Search issues", keys: ["/"] },
  help: { label: "Keyboard shortcuts", keys: ["?"] },
};

// The inline tabs and their provider workspace mount together. Keep their
// commands in one place so a keystroke can only navigate one visible surface.
function shortcutCommands() {
  const owners = new Map<string, { scope: Scope; commands: Commands }>();
  const listeners = new Set<() => void>();
  let commands: Commands = {};
  let pendingFocus: FocusDestination | null = null;
  let snapshot: { scope: Scope; actions: Partial<Record<Action, boolean>> } = {
    scope: "inline",
    actions: {},
  };
  function publish() {
    commands = {};
    let scope: Scope = "inline";
    for (const owner of [owners.get("workspace"), owners.get("tabs")]) {
      if (!owner) continue;
      scope = owner.scope;
      Object.assign(commands, owner.commands);
    }
    const next = {
      scope,
      actions: Object.fromEntries(
        Object.entries(commands).map(([id, command]) => [id, command.enabled]),
      ),
    };
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  return {
    get: () => snapshot,
    requestFocus(destination: FocusDestination) {
      pendingFocus = destination;
    },
    pendingFocus: () => pendingFocus,
    cancelFocus() {
      pendingFocus = null;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(owner: string, scope: Scope, next: Commands) {
      owners.set(owner, { scope, commands: next });
      publish();
    },
    remove(owner: string) {
      owners.delete(owner);
      publish();
    },
    execute(action: Action) {
      const command = commands[action];
      if (!command?.enabled) return false;
      command.run();
      return true;
    },
  };
}

type ShortcutContextValue = {
  controller: ReturnType<typeof shortcutCommands>;
  scope: Scope;
  actions: Partial<Record<Action, boolean>>;
  enabled: boolean;
  openHelp: () => void;
};
const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function useShortcuts() {
  return useContext(ShortcutContext);
}

export function useIssueShortcuts(
  owner: "workspace" | "tabs",
  scope: Scope,
  commands: Commands,
) {
  const controller = useShortcuts()?.controller;
  useLayoutEffect(() => {
    controller?.set(owner, scope, commands);
  });
  useLayoutEffect(() => () => controller?.remove(owner), [controller, owner]);
}

function hasOpenOverlay(document: Document) {
  return [
    ...document.querySelectorAll<HTMLElement>(
      'details.detail-utilities[open], details.linear-reaction-picker[open], [role="dialog"], [role="menu"], [role="listbox"], [data-arco-selection-toolbar]',
    ),
  ].some(
    (element) =>
      !element.closest("[inert]") && element.getClientRects().length > 0,
  );
}

export function KeyboardShortcutsProvider({
  host,
  children,
}: {
  host: ArcoHost;
  children: ReactNode;
}) {
  // The workspace owns the initial read and its explicit error recovery.
  const settings = useSettings(host, { enabled: false });
  const enabled =
    settings.query.data?.settings.characterShortcutsEnabled ?? false;
  const controller = useMemo(shortcutCommands, []);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.get);
  const [helpOpen, setHelpOpen] = useState(false);
  const prefix = useRef(0);
  const scope = useRef<HTMLDivElement>(null);
  const openHelp = () => {
    prefix.current = 0;
    controller.cancelFocus();
    setHelpOpen(true);
  };
  useEffect(() => {
    const reset = () => {
      prefix.current = 0;
      controller.cancelFocus();
    };
    window.addEventListener("blur", reset);
    return () => window.removeEventListener("blur", reset);
  }, [controller]);
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !scope.current?.contains(target))
      return;
    const document = target.ownerDocument;
    const key = event.key.toLowerCase();
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      (event.shiftKey && key !== "?") ||
      target.isContentEditable ||
      target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="spinbutton"],[role="slider"],[aria-haspopup]',
      ) ||
      hasOpenOverlay(document) ||
      document.getSelection()?.isCollapsed === false
    ) {
      prefix.current = 0;
      return;
    }
    if (!enabled) {
      prefix.current = 0;
      return;
    }
    if (key === "g" && !event.repeat && snapshot.actions.list !== undefined) {
      prefix.current = Date.now() + 1000;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const sequence = key === "i" && Date.now() <= prefix.current;
    prefix.current = 0;
    if (event.repeat) return;
    const action = sequence
      ? "list"
      : key === "j"
        ? "next"
        : key === "k"
          ? "previous"
          : key === "/"
            ? "search"
            : null;
    if (key === "?") openHelp();
    else if (!action || !controller.execute(action)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const visibleHints = (Object.keys(hints) as (Action | "help")[])
    .filter((id) => id === "help" || snapshot.actions[id] !== undefined)
    .map((id) => hints[id]);
  if (snapshot.scope === "tabs") {
    visibleHints.push(
      {
        label: "Switch tabs",
        keys: ["←", "→"],
        condition: "When a tab is focused",
      },
      {
        label: "First / last tab",
        keys: ["Home", "End"],
        condition: "When a tab is focused",
      },
    );
  }
  return (
    <ShortcutContext.Provider
      value={{ controller, ...snapshot, enabled, openHelp }}
    >
      <div
        ref={scope}
        className="arco-shortcut-scope"
        tabIndex={-1}
        onKeyDown={keydown}
        onPointerDownCapture={(event) => {
          prefix.current = 0;
          controller.cancelFocus();
          const control =
            event.target instanceof Element
              ? event.target.closest(
                  'button,input,textarea,select,a,summary,label,[tabindex],[contenteditable],[role="button"]',
                )
              : null;
          if (!control || control === scope.current)
            scope.current?.focus({ preventScroll: true });
        }}
        onFocusCapture={() => {
          prefix.current = 0;
          controller.cancelFocus();
        }}
        onBlurCapture={() => {
          prefix.current = 0;
        }}
      >
        {children}
        <ShortcutHelpDialog
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          scope={snapshot.scope}
          hints={visibleHints}
          enabled={enabled}
          onEnabledChange={(value) =>
            settings.update("keyboard-shortcuts", () => ({
              characterShortcutsEnabled: value,
            }))
          }
          saving={settings.pending}
          error={settings.error}
          onRetry={settings.retry}
        />
      </div>
    </ShortcutContext.Provider>
  );
}

export function ShortcutHelpButton() {
  const shortcuts = useShortcuts();
  if (!shortcuts) return null;
  return (
    <ShortcutTooltip
      label={hints.help.label}
      keys={shortcuts.enabled ? hints.help.keys : undefined}
    >
      <button
        type="button"
        className="icon-button"
        aria-label={hints.help.label}
        aria-keyshortcuts={shortcuts.enabled ? "Shift+/" : undefined}
        onClick={shortcuts.openHelp}
      >
        <Keyboard aria-hidden="true" />
      </button>
    </ShortcutTooltip>
  );
}

export function ShortcutMenuItems() {
  const shortcuts = useShortcuts();
  if (!shortcuts) return null;
  return (
    <div className="shortcut-menu-group">
      {(["list", "help"] as const).map((id) => {
        if (id !== "help" && shortcuts.actions[id] === undefined) return null;
        const hint = hints[id];
        return (
          <button
            type="button"
            className="utility-item shortcut-menu-item"
            key={id}
            aria-label={hint.label}
            disabled={id !== "help" && !shortcuts.actions[id]}
            onClick={(event) => {
              const menu = event.currentTarget.closest("details");
              if (menu) {
                menu.open = false;
                menu.querySelector("summary")?.focus();
              }
              if (id === "help") shortcuts.openHelp();
              else shortcuts.controller.execute(id);
            }}
          >
            {id === "help" ? (
              <Keyboard aria-hidden="true" />
            ) : (
              <ArrowLeft aria-hidden="true" />
            )}
            <span>{hint.label}</span>
            {shortcuts.enabled && (
              <ShortcutKeys keys={hint.keys} sequence={hint.sequence} />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function IssueNavigationButtons() {
  const shortcuts = useShortcuts();
  if (!shortcuts || shortcuts.actions.next === undefined) return null;
  const Previous = shortcuts.scope === "tabs" ? ChevronLeft : ChevronUp;
  const Next = shortcuts.scope === "tabs" ? ChevronRight : ChevronDown;
  return (
    <div
      className="issue-navigation"
      role="group"
      aria-label="Issue navigation"
    >
      {(["previous", "next"] as const).map((action) => {
        const hint = hints[action];
        const Icon = action === "previous" ? Previous : Next;
        return (
          <ShortcutTooltip
            key={action}
            label={hint.label}
            keys={shortcuts.enabled ? hint.keys : undefined}
          >
            <button
              type="button"
              className="icon-button"
              aria-label={hint.label}
              disabled={!shortcuts.actions[action]}
              onClick={() => shortcuts.controller.execute(action)}
            >
              <Icon aria-hidden="true" />
            </button>
          </ShortcutTooltip>
        );
      })}
    </div>
  );
}
