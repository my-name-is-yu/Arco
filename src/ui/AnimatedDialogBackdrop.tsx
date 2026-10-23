import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactNode,
} from "react";

export function AnimatedDialogBackdrop({
  open,
  children,
  onClick,
  className = "",
}: {
  open: boolean;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLDivElement>;
  className?: string;
}) {
  const [present, setPresent] = useState(false);
  const backdrop = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !backdrop.current?.contains(active))
      opener.current = active;
    // Capture the opener before child autoFocus runs on its first mount.
    setPresent(true);
    return () => {
      if (opener.current?.isConnected)
        opener.current.focus({ preventScroll: true });
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !present || backdrop.current?.contains(document.activeElement))
      return;
    backdrop.current
      ?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([tabindex="-1"]), textarea, button:not(:disabled)',
      )
      ?.focus({ preventScroll: true });
  }, [open, present]);

  useEffect(() => {
    if (open || !present) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finish = () => setPresent(false);
    if (preference.matches) {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, 140);
    const changed = () => {
      if (preference.matches) finish();
    };
    preference.addEventListener("change", changed);
    return () => {
      window.clearTimeout(timer);
      preference.removeEventListener("change", changed);
    };
  }, [open, present]);

  if (!present) return null;
  return (
    <div
      ref={backdrop}
      className={`dialog-backdrop animated-dialog-backdrop ${className}`}
      data-state={open ? "open" : "closed"}
      inert={!open}
      aria-hidden={!open || undefined}
      onClick={open ? onClick : undefined}
    >
      {children}
    </div>
  );
}
