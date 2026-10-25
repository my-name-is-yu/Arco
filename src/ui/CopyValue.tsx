import { useRef, useState } from "react";

export function CopyValue({
  value,
  label = "Copy link",
  onCopied,
}: {
  value: string;
  label?: string;
  onCopied?: (button: HTMLButtonElement) => void;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const input = useRef<HTMLInputElement>(null);
  const copy = async (button: HTMLButtonElement) => {
    const stillActive = () =>
      button.ownerDocument.hasFocus() &&
      button.ownerDocument.activeElement === button &&
      !button.closest("details:not([open])");
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
      if (stillActive()) onCopied?.(button);
    } catch {
      setStatus("manual");
      requestAnimationFrame(() => {
        if (!stillActive()) return;
        input.current?.focus();
        input.current?.select();
      });
    }
  };
  return (
    <span className="copy-value">
      <button
        className="text-button"
        onClick={(event) => void copy(event.currentTarget)}
      >
        {status === "copied" ? "Copied" : label}
      </button>
      {status === "manual" && (
        <label className="manual-copy">
          Select and copy
          <input
            ref={input}
            readOnly
            value={value}
            aria-label="Value to copy"
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
    </span>
  );
}
