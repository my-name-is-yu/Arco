import type { ReactNode } from "react";
import {
  ArrowLeft,
  DotsHorizontalMoreMenu,
} from "@openai/apps-sdk-ui/components/Icon";
import {
  IssueNavigationButtons,
  ShortcutMenuItems,
  useShortcuts,
} from "./keyboard-shortcuts";
import { ShortcutTooltip } from "./ShortcutUI";

export function closeDetailUtility(button: HTMLElement) {
  const menu = button.closest<HTMLDetailsElement>("details.detail-utilities");
  if (!menu) return;
  menu.open = false;
  menu.querySelector("summary")?.focus();
}

export function DetailToolbar({
  target,
  shared,
  primary,
  utilities,
  backLabel,
  onBack,
}: {
  target: string;
  shared?: ReactNode;
  primary: ReactNode;
  utilities: ReactNode;
  backLabel: string;
  onBack: () => void;
}) {
  const shortcuts = useShortcuts();
  return (
    <header className="detail-toolbar">
      <div className="toolbar-left">
        <ShortcutTooltip
          label={backLabel}
          keys={shortcuts?.enabled ? ["G", "I"] : undefined}
          sequence
        >
          <button
            className="icon-button mobile-back"
            aria-label={backLabel}
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
        </ShortcutTooltip>
        <span className="toolbar-target" title={target}>
          {target}
        </span>
        {shared}
        <IssueNavigationButtons />
      </div>
      <div className="detail-primary-actions">{primary}</div>
      <details
        className="detail-utilities"
        onClick={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          const button = target?.closest<HTMLButtonElement>("button");
          if (button && !button.closest(".copy-value"))
            closeDetailUtility(button);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          event.preventDefault();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }}
      >
        <summary aria-label="Issue actions" title="Issue actions">
          <DotsHorizontalMoreMenu aria-hidden="true" />
        </summary>
        <div className="detail-utility-menu">
          {utilities}
          <ShortcutMenuItems />
        </div>
      </details>
    </header>
  );
}
