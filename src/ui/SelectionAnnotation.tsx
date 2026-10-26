import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Check, Trash } from "@openai/apps-sdk-ui/components/Icon";

export interface AnnotationTarget {
  range?: Range;
  sourceText: string;
  editable?: {
    element: HTMLInputElement | HTMLTextAreaElement;
    start: number;
    end: number;
    value: string;
  };
}

function clipBounds(element: Element | null) {
  let left = 0;
  let right = window.innerWidth;
  let top = 0;
  let bottom = window.innerHeight;
  for (let parent = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, bounds.left + parent.clientLeft);
      right = Math.min(
        right,
        bounds.left + parent.clientLeft + parent.clientWidth,
      );
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, bounds.top + parent.clientTop);
      bottom = Math.min(
        bottom,
        bounds.top + parent.clientTop + parent.clientHeight,
      );
    }
  }
  return { left, right, top, bottom };
}

function clipRect(rect: DOMRect, bounds: ReturnType<typeof clipBounds>) {
  const left = Math.max(bounds.left, rect.left);
  const right = Math.min(bounds.right, rect.right);
  const top = Math.max(bounds.top, rect.top);
  const bottom = Math.min(bounds.bottom, rect.bottom);
  return new DOMRect(
    left,
    top,
    Math.max(0, right - left),
    Math.max(0, bottom - top),
  );
}

function targetRect(target: AnnotationTarget) {
  const input = target.editable;
  if (input)
    return input.element.isConnected && input.element.value === input.value
      ? clipRect(
          input.element.getBoundingClientRect(),
          clipBounds(input.element.parentElement),
        )
      : null;
  const range = target.range;
  if (
    !range?.startContainer.isConnected ||
    !range.endContainer.isConnected ||
    range.toString() !== target.sourceText
  )
    return null;
  const element =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const rectangles = range.getClientRects();
  if (!rectangles.length) return null;
  const bounds = clipBounds(element);
  for (const rect of rectangles) {
    const visible = clipRect(rect, bounds);
    if (visible.width > 0 && visible.height > 0) return visible;
  }
  return null;
}

function fieldStyle(input: HTMLInputElement | HTMLTextAreaElement) {
  const style = getComputedStyle(input);
  return {
    font: style.font,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    textAlign: style.textAlign as CSSProperties["textAlign"],
    textIndent: style.textIndent,
    padding: style.padding,
    borderWidth: style.borderWidth,
    borderStyle: "solid",
    whiteSpace: input instanceof HTMLTextAreaElement ? "pre-wrap" : "pre",
    overflowWrap: style.overflowWrap as CSSProperties["overflowWrap"],
    wordBreak: style.wordBreak as CSSProperties["wordBreak"],
    tabSize: style.tabSize,
  } satisfies CSSProperties;
}

export interface AnnotationLayout {
  rect: DOMRect;
  field?: {
    rect: DOMRect;
    style: CSSProperties;
    scrollLeft: number;
    scrollTop: number;
  };
  badge: { left: number; top: number };
  editor: { left: number; top: number; width: number };
}

export function measureSelectionAnnotation(
  target: AnnotationTarget,
  badgeOffsetFor: (rect: DOMRect) => number,
  editorHeight = 28,
): AnnotationLayout | null {
  const rect = targetRect(target);
  if (!rect) return null;
  const badgeOffset = badgeOffsetFor(rect);
  const input = target.editable?.element;
  const width = Math.min(300, window.innerWidth - 16);
  const height = editorHeight + 18;
  return {
    rect,
    ...(input
      ? {
          field: {
            rect: input.getBoundingClientRect(),
            style: fieldStyle(input),
            scrollLeft: input.scrollLeft,
            scrollTop: input.scrollTop,
          },
        }
      : {}),
    badge: {
      left: Math.max(8, Math.min(rect.right + 3, window.innerWidth - 38)),
      top:
        Math.max(
          8,
          Math.min(rect.top - 25, window.innerHeight - 38 - badgeOffset * 34),
        ) +
        badgeOffset * 34,
    },
    editor: {
      width,
      left: Math.max(
        8,
        Math.min(
          rect.left + rect.width / 2 - width / 2,
          window.innerWidth - width - 8,
        ),
      ),
      top: Math.max(
        8,
        Math.min(
          rect.top >= height + 16 ? rect.top - height - 8 : rect.bottom + 8,
          window.innerHeight - height - 8,
        ),
      ),
    },
  };
}

export function SelectionAnnotation({
  number,
  target,
  layout,
  comment,
  editing,
  onEdit,
  onDismiss,
  busy,
  error,
  onSave,
  onRemove,
  onLayoutChange,
}: {
  number: number;
  target: AnnotationTarget;
  layout: AnnotationLayout | null;
  comment: string;
  editing: boolean;
  onEdit: () => void;
  onDismiss: () => void;
  busy: boolean;
  error: string;
  onSave: (number: number, comment: string) => Promise<boolean>;
  onRemove: (number: number) => Promise<void>;
  onLayoutChange: () => void;
}) {
  const [draft, setDraft] = useState(comment);
  const editor = useRef<HTMLTextAreaElement>(null);
  const badge = useRef<HTMLButtonElement>(null);
  const input = target.editable;
  const visible = Boolean(
    layout && layout.rect.width > 0 && layout.rect.height > 0,
  );

  useEffect(() => {
    if (editing) setDraft(comment);
  }, [editing, comment]);
  useEffect(() => {
    if (editing && visible) {
      editor.current?.focus({ preventScroll: true });
      onLayoutChange();
    }
  }, [editing, visible, onLayoutChange]);

  if (!layout) return null;
  const { rect, field } = layout;
  const fieldRect = field?.rect;
  return (
    <>
      {input && field && fieldRect && visible && (
        <div
          className="selection-retained-input"
          aria-hidden="true"
          style={{
            left: fieldRect.left,
            top: fieldRect.top,
            width: fieldRect.width,
            height: fieldRect.height,
            clipPath: `inset(${rect.top - fieldRect.top}px ${fieldRect.right - rect.right}px ${fieldRect.bottom - rect.bottom}px ${rect.left - fieldRect.left}px)`,
          }}
        >
          <div
            style={{
              ...field.style,
              transform: `translate(${-field.scrollLeft}px, ${-field.scrollTop}px)`,
            }}
          >
            {input.value.slice(0, input.start)}
            <mark>{input.value.slice(input.start, input.end)}</mark>
            {input.value.slice(input.end)}
          </div>
        </div>
      )}
      <div
        className="arco"
        data-arco-selection-toolbar
        data-arco-annotation={number}
        style={{ visibility: visible ? "visible" : "hidden" }}
      >
        <button
          ref={badge}
          className="selection-annotation-number"
          aria-label={`Edit selection comment ${number}`}
          aria-expanded={editing}
          style={layout.badge}
          onClick={() => {
            setDraft(comment);
            onEdit();
          }}
        >
          {number}
        </button>
        {editing && (
          <div
            role="dialog"
            aria-label="Selection comment"
            className="selection-comment"
            style={layout.editor}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.stopPropagation();
                if (!busy) onDismiss();
                badge.current?.focus({ preventScroll: true });
              }
            }}
          >
            <textarea
              ref={editor}
              aria-label="Optional comment"
              placeholder="Add an optional comment…"
              rows={1}
              value={draft}
              disabled={busy}
              onChange={(event) => {
                setDraft(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(120, event.target.scrollHeight)}px`;
                onLayoutChange();
              }}
            />
            <Button
              aria-label={`Remove annotation ${number}`}
              color="secondary"
              variant="ghost"
              size="sm"
              pill
              className="selection-comment-remove"
              disabled={busy}
              onClick={() => void onRemove(number)}
            >
              <Trash aria-hidden="true" />
            </Button>
            <Button
              aria-label="Save comment"
              color="primary"
              variant="solid"
              size="sm"
              pill
              disabled={busy}
              onClick={() => {
                void onSave(number, draft).then((saved) => {
                  if (saved) {
                    onDismiss();
                    badge.current?.focus({ preventScroll: true });
                  }
                });
              }}
            >
              <Check aria-hidden="true" />
            </Button>
            {error && (
              <span className="selection-share-error" role="alert">
                {error}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
