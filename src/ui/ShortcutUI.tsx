import { Fragment, useId, type ReactElement } from "react";
import { Tooltip } from "@openai/apps-sdk-ui/components/Tooltip";
import { AnimatedDialogBackdrop } from "./AnimatedDialogBackdrop";
import "./shortcuts.css";

export type ShortcutHint = {
  label: string;
  keys: readonly string[];
  sequence?: boolean;
  condition?: string;
};

export function ShortcutKeys({
  keys,
  sequence = false,
}: {
  keys: readonly string[];
  sequence?: boolean;
}) {
  return (
    <span className="shortcut-keys">
      {keys.map((key, index) => (
        <Fragment key={`${index}:${key}`}>
          {index > 0 && (
            <span className="shortcut-key-separator">
              {sequence ? "then" : "or"}
            </span>
          )}
          <kbd>{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function ShortcutTooltip({
  label,
  keys,
  sequence,
  children,
}: {
  label: string;
  keys?: readonly string[];
  sequence?: boolean;
  children: ReactElement;
}) {
  return (
    <Tooltip
      content={
        <span className="shortcut-tooltip-content">
          <span>{label}</span>
          {keys && keys.length > 0 && (
            <ShortcutKeys keys={keys} sequence={sequence} />
          )}
        </span>
      }
      contentClassName="arco-shortcut-tooltip"
      maxWidth={280}
      openDelay={350}
      compact
    >
      {children}
    </Tooltip>
  );
}

const scopeLabels = {
  workspace: "Issue list",
  tabs: "This issue set",
  inline: "This issue",
};

export function ShortcutHelpDialog({
  open,
  onClose,
  scope,
  hints,
  enabled,
  onEnabledChange,
  saving = false,
  error,
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  scope: "workspace" | "tabs" | "inline";
  hints: ShortcutHint[];
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  saving?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const id = useId();
  return (
    <AnimatedDialogBackdrop
      open={open}
      className="shortcut-help-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="arco shortcut-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            (event.target instanceof Element &&
              event.target.closest('[role="dialog"]') !== event.currentTarget)
          )
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([type="hidden"]):not([tabindex="-1"])',
            ),
          ].filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (!first) {
            event.preventDefault();
            event.currentTarget.focus();
          } else if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="dialog-heading shortcut-help-heading">
          <h2 id={`${id}-title`}>Keyboard shortcuts</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="shortcut-help-content">
          <p id={`${id}-description`} className="shortcut-help-description">
            Click inside Arco to use shortcuts. Paused while typing.
          </p>
          <h3>{scopeLabels[scope]}</h3>
          <dl className="shortcut-help-list">
            {hints.map((hint) => (
              <div className="shortcut-help-row" key={hint.label}>
                <dt>
                  {hint.label}
                  {hint.condition && (
                    <span className="shortcut-help-condition">
                      {hint.condition}
                    </span>
                  )}
                </dt>
                <dd>
                  <ShortcutKeys keys={hint.keys} sequence={hint.sequence} />
                </dd>
              </div>
            ))}
          </dl>
          <div className="shortcut-help-setting" aria-busy={saving}>
            <label>
              <input
                type="checkbox"
                checked={enabled}
                aria-disabled={saving || undefined}
                onChange={(event) => {
                  if (!saving) onEnabledChange(event.currentTarget.checked);
                }}
              />
              Enable keyboard shortcuts
            </label>
            <p>Tab, arrow keys and Esc always work.</p>
            {error && (
              <div className="shortcut-help-error" role="alert">
                <p>{error}</p>
                {onRetry && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={saving}
                    onClick={onRetry}
                  >
                    Retry saving
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </AnimatedDialogBackdrop>
  );
}
