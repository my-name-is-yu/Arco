import type { ReactNode } from "react";
export type NoticeValue = { kind: "error" | "info"; text: string };
export function Notice({
  notice,
  onDismiss,
  dismissLabel = "Dismiss notification",
  children,
}: {
  notice: NoticeValue | null;
  onDismiss?: () => void;
  dismissLabel?: string;
  children?: ReactNode;
}) {
  if (!notice) return null;
  return (
    <div
      className={`notice ${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      <span>{notice.text}</span>
      {children}
      {onDismiss && (
        <button
          className="icon-button"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          ×
        </button>
      )}
    </div>
  );
}
