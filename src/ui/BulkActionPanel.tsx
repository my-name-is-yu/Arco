import type { ReactNode } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";

export function BulkActionPanel({
  label,
  count,
  busy,
  disabled,
  onClear,
  onApply,
  children,
  feedback,
}: {
  label: string;
  count: number;
  busy: boolean;
  disabled: boolean;
  onClear: () => void;
  onApply: () => void;
  children: ReactNode;
  feedback?: ReactNode;
}) {
  return (
    <section className="bulk-actions" aria-label={label}>
      <div className="bulk-heading">
        <strong>{count} selected</strong>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>
      {children}
      <Button
        color="primary"
        size="sm"
        block
        loading={busy}
        disabled={disabled}
        onClick={onApply}
      >
        {busy ? "Applying…" : `Apply to ${count} issues`}
      </Button>
      {feedback}
    </section>
  );
}
