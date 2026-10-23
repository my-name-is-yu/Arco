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

function clipRect(rect: DOMRect, element: Element | null) {
  let left = Math.max(0, rect.left);
  let right = Math.min(window.innerWidth, rect.right);
  let top = Math.max(0, rect.top);
  let bottom = Math.min(window.innerHeight, rect.bottom);
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
          input.element.parentElement,
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
  const visible = Array.from(range.getClientRects(), (rect) =>
    clipRect(rect, element),
  );
  return (
    visible.find((rect) => rect.width > 0 && rect.height > 0) ??
    visible[0] ??
    new DOMRect()
  );
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

export function SelectionAnnotation({
  number,
  target,
  badgeOffset,
  comment,
  editing,
  onEdit,
  onDismiss,
  busy,
  error,
  onSave,
  onRemove,
  onInvalid,
}: {
  number: number;
  target: AnnotationTarget;
  badgeOffset: number;
  comment: string;
  editing: boolean;
  onEdit: () => void;
  onDismiss: () => void;
  busy: boolean;
  error: string;
  onSave: (number: number, comment: string) => Promise<boolean>;
  onRemove: (number: number) => Promise<void>;
  onInvalid: (number: number) => void;
}) {
  const [draft, setDraft] = useState(comment);
  const [rect, setRect] = useState(() => targetRect(target));
  const editor = useRef<HTMLTextAreaElement>(null);
  const badge = useRef<HTMLButtonElement>(null);
  const input = target.editable;
  const dismiss = () => {
    if (busy) return;
    onDismiss();
  };

  useEffect(() => {
    const position = () => {
      const next = targetRect(target);
      if (next) setRect(next);
      else onInvalid(number);
    };
    const observer = new MutationObserver(position);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.addEventListener("scroll", position, true);
    document.addEventListener("toggle", position, true);
    document.addEventListener("input", position);
    window.addEventListener("resize", position);
    position();
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", position, true);
      document.removeEventListener("toggle", position, true);
      document.removeEventListener("input", position);
      window.removeEventListener("resize", position);
    };
  }, [target, number, onInvalid]);

  useEffect(() => {
    if (editing) {
      setDraft(comment);
      editor.current?.focus({ preventScroll: true });
    }
  }, [editing, comment]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        editing &&
        !busy &&
        event.target instanceof Element &&
        !event.target.closest("[data-arco-selection-toolbar]")
      ) {
        onDismiss();
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [busy, editing, onDismiss]);

  if (!rect) return null;
  const visible = rect.width > 0 && rect.height > 0;
  const fieldRect = input?.element.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 16);
  const x = Math.max(
    8,
    Math.min(
      rect.left + rect.width / 2 - width / 2,
      window.innerWidth - width - 8,
    ),
  );
  const height = (editor.current?.offsetHeight ?? 28) + 18;
  const y = Math.max(
    8,
    Math.min(
      rect.top >= height + 16 ? rect.top - height - 8 : rect.bottom + 8,
      window.innerHeight - height - 8,
    ),
  );
  return (
    <>
      {input && fieldRect && visible && (
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
              ...fieldStyle(input.element),
              transform: `translate(${-input.element.scrollLeft}px, ${-input.element.scrollTop}px)`,
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
        style={{ visibility: visible ? "visible" : "hidden" }}
      >
        <button
          ref={badge}
          className="selection-annotation-number"
          aria-label={`Edit selection comment ${number}`}
          aria-expanded={editing}
          style={{
            left: Math.max(8, Math.min(rect.right + 3, window.innerWidth - 38)),
            top:
              Math.max(
                8,
                Math.min(
                  rect.top - 25,
                  window.innerHeight - 38 - badgeOffset * 34,
                ),
              ) +
              badgeOffset * 34,
          }}
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
            style={{ left: x, top: y, width }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.stopPropagation();
                dismiss();
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
