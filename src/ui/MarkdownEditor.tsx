import type { ReactNode } from "react";
export function MarkdownEditor({
  title,
  body,
  titleLabel,
  bodyLabel,
  label,
  busy,
  preview,
  onPreview,
  onTitle,
  onBody,
  renderedBody,
  children,
}: {
  title: string;
  body: string;
  titleLabel: string;
  bodyLabel: string;
  label: string;
  busy: boolean;
  preview: boolean;
  onPreview: (preview: boolean) => void;
  onTitle: (title: string) => void;
  onBody: (body: string) => void;
  renderedBody: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="editor" aria-label={label}>
      <label>
        Title
        <input
          aria-label={titleLabel}
          disabled={busy}
          value={title}
          maxLength={256}
          onChange={(event) => onTitle(event.target.value)}
        />
      </label>
      <div className="editor-tabs" data-motion="selection">
        <button
          type="button"
          aria-pressed={!preview}
          onClick={() => onPreview(false)}
        >
          Edit
        </button>
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => onPreview(true)}
        >
          Preview
        </button>
      </div>
      {preview ? (
        renderedBody
      ) : (
        <textarea
          aria-label={bodyLabel}
          rows={14}
          disabled={busy}
          value={body}
          onChange={(event) => onBody(event.target.value)}
        />
      )}
      {children}
    </section>
  );
}
