import { useState, type ReactNode } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
export function ConflictPanel({
  source,
  latestTitle,
  latestBody,
  busy,
  onKeep,
  onUseLatest,
}: {
  source: string;
  latestTitle: string;
  latestBody: ReactNode;
  busy: boolean;
  onKeep: () => void;
  onUseLatest: () => void;
}) {
  const [comparing, setComparing] = useState(false);
  return (
    <section
      className="draft-conflict"
      aria-label="Content conflict"
      role="alert"
    >
      <strong>
        The title or body changed on {source} while you were editing.
      </strong>
      <p>Your draft is preserved. Compare the latest content before saving.</p>
      <button
        type="button"
        className="text-button"
        aria-expanded={comparing}
        onClick={() => setComparing((value) => !value)}
      >
        {comparing ? "Close comparison" : "Compare latest content"}
      </button>
      {comparing && (
        <div className="latest-content">
          <h3>Latest content on {source}</h3>
          <strong>{latestTitle}</strong>
          {latestBody}
          <div className="editor-actions">
            <Button
              type="button"
              color="secondary"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onKeep}
            >
              Keep draft and use latest revision
            </Button>
            <Button
              type="button"
              color="secondary"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onUseLatest}
            >
              Discard draft and use latest content
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
