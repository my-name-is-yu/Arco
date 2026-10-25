import { useEffect, useRef, type ReactNode } from "react";
import { AnimatedDialogBackdrop } from "./AnimatedDialogBackdrop";
export function CreateDialog({
  open,
  busy,
  title,
  titleId,
  closeLabel,
  onClose,
  scope,
  children,
}: {
  open: boolean;
  busy: boolean;
  title: string;
  titleId: string;
  closeLabel: string;
  onClose: () => void;
  scope: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open && busy) dialog.current?.focus({ preventScroll: true });
  }, [open, busy]);
  return (
    <AnimatedDialogBackdrop
      open={open}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className="create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            (event.target instanceof Element &&
              event.target.closest('[role="dialog"]') !== event.currentTarget)
          )
            return;
          if (event.key === "Escape") {
            event.stopPropagation();
            if (!busy) onClose();
          }
          if (event.key !== "Tab") return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled):not([tabindex="-1"]),input:not(:disabled):not([type="hidden"]):not([tabindex="-1"]),textarea:not(:disabled):not([tabindex="-1"]),[role="button"][tabindex="0"]:not([aria-disabled="true"])',
            ),
          ].filter((element) => element.getClientRects().length > 0);
          if (!controls.length) {
            event.preventDefault();
            event.currentTarget.focus();
            return;
          }
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
            return;
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={closeLabel}
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="muted">{scope}</p>
        {children}
      </section>
    </AnimatedDialogBackdrop>
  );
}
