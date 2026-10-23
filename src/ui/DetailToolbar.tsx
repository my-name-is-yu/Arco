import type { ReactNode } from "react";
import {
  ArrowLeft,
  DotsHorizontalMoreMenu,
} from "@openai/apps-sdk-ui/components/Icon";

export function closeDetailUtility(button: HTMLElement) {
  const menu = button.closest<HTMLDetailsElement>("details.detail-utilities");
  if (!menu) return;
  menu.open = false;
  menu.querySelector("summary")?.focus();
}

export function DetailToolbar({
  tab,
  shared,
  primary,
  utilities,
  backLabel,
  onBack,
}: {
  tab: string;
  shared?: ReactNode;
  primary: ReactNode;
  utilities: ReactNode;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <header className="detail-toolbar">
      <div className="toolbar-left">
        <button
          className="icon-button mobile-back"
          aria-label={backLabel}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <span className="toolbar-tab">{tab}</span>
        {shared}
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
        <div className="detail-utility-menu">{utilities}</div>
      </details>
    </header>
  );
}
