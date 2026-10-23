import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useTextSelection } from "@openai/apps-sdk-ui/hooks/useTextSelection";
import {
  type ArcoHost,
  type IssueSummary,
  type SelectionIssue,
  type TextSelectionContext,
  type SelectionAnnotationContext,
} from "../shared/contracts";
import type { LinearIssueSummary } from "../shared/linear";
import { selectionIssueSchema } from "./shared-context";
import {
  captureSelectionAnchor,
  restoreSelectionTarget,
  type SelectionAnchor,
} from "./selection-anchor";
import {
  SelectionAnnotation,
  type AnnotationTarget,
} from "./SelectionAnnotation";

export function selectionIssueData(issue: IssueSummary | LinearIssueSummary) {
  const context: SelectionIssue =
    issue.source === "github"
      ? {
          source: issue.source,
          repo: issue.repo,
          number: issue.number,
          id: issue.id,
          title: issue.title,
          url: issue.url,
          state: issue.state,
        }
      : {
          source: issue.source,
          connectionId: issue.connectionId,
          workspaceId: issue.workspaceId,
          teamId: issue.teamId,
          id: issue.issueId,
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          state: issue.state,
        };
  return JSON.stringify(context);
}

export function isTextSelectionClick(element: HTMLElement) {
  const selection = window.getSelection();
  return Boolean(
    selection &&
    !selection.isCollapsed &&
    selection.toString().trim() &&
    selection.anchorNode &&
    selection.focusNode &&
    element.contains(selection.anchorNode) &&
    element.contains(selection.focusNode),
  );
}

function elementFor(node: Node | null) {
  return node instanceof Element ? node : node?.parentElement;
}
function issueFor(start: Element | null | undefined, end = start) {
  const container = start?.closest<HTMLElement>("[data-arco-issue]");
  if (!container || container !== end?.closest("[data-arco-issue]"))
    return undefined;
  const startData = container.dataset.arcoIssue;
  if (!startData) return undefined;
  try {
    const parsed = selectionIssueSchema.safeParse(JSON.parse(startData));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

type Editable = HTMLInputElement | HTMLTextAreaElement;
type RangeSnapshot = Pick<
  Range,
  "startContainer" | "startOffset" | "endContainer" | "endOffset"
> & { sourceText: string };
type Selected = TextSelectionContext & {
  x: number;
  y: number;
  editable?: Editable;
  editableStart?: number;
  editableEnd?: number;
  editableValue?: string;
  range?: RangeSnapshot;
};
type Annotation = {
  context: SelectionAnnotationContext;
  target: AnnotationTarget | null;
};

function sameSelection(a: TextSelectionContext, b: TextSelectionContext) {
  const x = a.issue;
  const y = b.issue;
  const sameIssue =
    (!x && !y) ||
    (x &&
      y &&
      x.source === y.source &&
      (x.source === "github" && y.source === "github"
        ? x.repo === y.repo && x.number === y.number
        : x.source === "linear" &&
          y.source === "linear" &&
          x.connectionId === y.connectionId &&
          x.workspaceId === y.workspaceId &&
          x.teamId === y.teamId &&
          x.id === y.id));
  return Boolean(
    sameIssue &&
    a.selection.text === b.selection.text &&
    a.selection.origin === b.selection.origin &&
    a.selection.commentId === b.selection.commentId &&
    a.selection.comment === b.selection.comment,
  );
}
function sameAnnotations(
  a: SelectionAnnotationContext[],
  b: SelectionAnnotationContext[],
) {
  return (
    a.length === b.length &&
    a.every(
      (item, index) =>
        item.number === b[index].number && sameSelection(item, b[index]),
    )
  );
}

function annotationTarget(selected: Selected): AnnotationTarget {
  if (selected.editable)
    return {
      sourceText: selected.selection.text,
      editable: {
        element: selected.editable,
        start: selected.editableStart!,
        end: selected.editableEnd!,
        value: selected.editableValue!,
      },
    };
  const snapshot = selected.range!;
  const range = document.createRange();
  range.setStart(snapshot.startContainer, snapshot.startOffset);
  range.setEnd(snapshot.endContainer, snapshot.endOffset);
  return { range, sourceText: snapshot.sourceText };
}
function atRect(context: TextSelectionContext, rect: DOMRect): Selected {
  const margin = 8;
  const width = 116;
  const height = 34;
  return {
    ...context,
    x: Math.max(
      margin,
      Math.min(
        rect.left + rect.width / 2 - width / 2,
        window.innerWidth - width - margin,
      ),
    ),
    y: Math.max(
      margin,
      Math.min(
        rect.top >= height + margin * 2
          ? rect.top - height - margin
          : rect.bottom + margin,
        window.innerHeight - height - margin,
      ),
    ),
  };
}

function readSelection(previous?: Selected): Selected | null {
  const editable = previous?.editable;
  const focused = document.activeElement;
  const active = focused?.closest(
    ".selection-comment, .selection-annotation-number",
  )
    ? null
    : focused?.closest("[data-arco-selection-toolbar]") && editable?.isConnected
      ? editable
      : focused;
  if (
    (active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement && active.type !== "password")) &&
    active.selectionStart !== null &&
    active.selectionEnd !== null &&
    active.selectionStart !== active.selectionEnd
  ) {
    const text = active.value.slice(active.selectionStart, active.selectionEnd);
    return text.trim()
      ? {
          ...atRect(
            { selection: { text, origin: "ui" }, issue: issueFor(active) },
            active.getBoundingClientRect(),
          ),
          editable: active,
          editableStart: active.selectionStart,
          editableEnd: active.selectionEnd,
          editableValue: active.value,
        }
      : null;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const renderedText = selection.toString();
  const range = selection.getRangeAt(0);
  const snapshot: RangeSnapshot = {
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset,
    sourceText: range.toString(),
  };
  // Measuring a range can make Chromium include closed <details> text in
  // Selection.toString(). Preserve its visible text only while both its range
  // and DOM text stay unchanged; new selections and changed content stay fresh.
  const before = previous?.range;
  const sameRange =
    before &&
    before.startContainer === snapshot.startContainer &&
    before.startOffset === snapshot.startOffset &&
    before.endContainer === snapshot.endContainer &&
    before.endOffset === snapshot.endOffset &&
    before.sourceText === snapshot.sourceText;
  const text = sameRange ? previous.selection.text : renderedText;
  const start = elementFor(range.startContainer);
  const end = elementFor(range.endContainer);
  if (
    !text.trim() ||
    !start?.isConnected ||
    !end?.isConnected ||
    start.closest("[data-arco-selection-toolbar]") ||
    end.closest("[data-arco-selection-toolbar]") ||
    !range.getClientRects().length
  )
    return null;
  const region = start.closest<HTMLElement>(
    "[data-context-origin], [data-linear-context]",
  );
  const origin = region?.contains(end)
    ? (region.dataset.contextOrigin ?? region.dataset.linearContext)
    : undefined;
  return {
    ...atRect(
      {
        issue: issueFor(start, end),
        selection: {
          text,
          origin: origin === "body" || origin === "comment" ? origin : "ui",
          ...(origin === "comment" && region?.dataset.commentId
            ? { commentId: region.dataset.commentId }
            : {}),
        },
      },
      range.getBoundingClientRect(),
    ),
    range: snapshot,
  };
}

export function SelectionShare({ host }: { host: ArcoHost }) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>(() =>
    (host.sharedAnnotations?.() ?? []).map((context) => ({
      context,
      target: null,
    })),
  );
  const current = useRef(annotations);
  const anchors = useRef(new Map<number, SelectionAnchor>());
  const nextNumber = useRef(
    Math.max(0, ...annotations.map((item) => item.context.number)) + 1,
  );
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const commit = useCallback((next: Annotation[]) => {
    current.current = next;
    setAnnotations(next);
    for (const number of anchors.current.keys())
      if (!next.some((item) => item.context.number === number))
        anchors.current.delete(number);
  }, []);
  const capture = useCallback(() => {
    if (lock.current) return;
    setSelected((previous) => readSelection(previous ?? undefined));
    setError("");
  }, []);
  useTextSelection(true, capture);
  const sync = useCallback(() => {
    const shared = host.sharedAnnotations?.() ?? [];
    if (
      sameAnnotations(
        current.current.map((item) => item.context),
        shared,
      )
    )
      return;
    commit(
      shared.map((context) => {
        const previous = current.current.find(
          (item) =>
            item.context.number === context.number &&
            sameSelection(
              {
                ...item.context,
                selection: { ...item.context.selection, comment: undefined },
              },
              {
                ...context,
                selection: { ...context.selection, comment: undefined },
              },
            ),
        );
        if (!previous) anchors.current.delete(context.number);
        return { context, target: previous?.target ?? null };
      }),
    );
    setEditing(null);
    nextNumber.current = Math.max(0, ...shared.map((item) => item.number)) + 1;
  }, [host, commit]);
  useEffect(() => {
    const reconnect = () => {
      let changed = false;
      const next = current.current.map((item) => {
        const number = item.context.number;
        if (item.target) {
          const anchor = captureSelectionAnchor(item.target);
          if (anchor) anchors.current.set(number, anchor);
          return item;
        }
        const anchor = anchors.current.get(number);
        const target = anchor && restoreSelectionTarget(anchor);
        if (!target) return item;
        changed = true;
        return { ...item, target };
      });
      if (changed) commit(next);
    };
    const observer = new MutationObserver(reconnect);
    reconnect();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-arco-issue"],
    });
    document.addEventListener("input", reconnect);
    return () => {
      observer.disconnect();
      document.removeEventListener("input", reconnect);
    };
  }, [annotations, commit]);
  useEffect(
    () =>
      host.subscribe((event) => {
        if (event !== "context" || lock.current) return;
        setSelected(null);
        sync();
        window.getSelection()?.removeAllRanges();
      }),
    [host, sync],
  );
  useEffect(() => {
    if (typeof Highlight === "undefined" || !CSS.highlights) return;
    const ranges = annotations.flatMap((item) =>
      item.target?.range ? [item.target.range] : [],
    );
    if (ranges.length)
      CSS.highlights.set("arco-selection", new Highlight(...ranges));
    else CSS.highlights.delete("arco-selection");
    return () => {
      CSS.highlights.delete("arco-selection");
    };
  }, [annotations]);
  useEffect(() => {
    const selectionchange = () => {
      if (!lock.current)
        setSelected((previous) => (previous ? readSelection(previous) : null));
    };
    const keyup = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" &&
        (event.shiftKey ||
          event.key === "Shift" ||
          ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a"))
      )
        capture();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      else if (
        event.key === "Tab" &&
        !event.shiftKey &&
        addButton.current &&
        !addButton.current.disabled &&
        !document.activeElement?.closest("[data-arco-selection-toolbar]")
      ) {
        event.preventDefault();
        addButton.current.focus({ preventScroll: true });
      }
    };
    const pointerdown = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-arco-selection-toolbar]")
      )
        setSelected(null);
    };
    const scroll = () => {
      if (!lock.current) setSelected(null);
    };
    const reposition = () =>
      setSelected((previous) => (previous ? readSelection(previous) : null));
    document.addEventListener("selectionchange", selectionchange);
    document.addEventListener("select", capture);
    document.addEventListener("keyup", keyup);
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", pointerdown);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("selectionchange", selectionchange);
      document.removeEventListener("select", capture);
      document.removeEventListener("keyup", keyup);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", pointerdown);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", reposition);
    };
  }, [capture]);
  const invalidate = useCallback(
    (number: number) => {
      commit(
        current.current.map((item) =>
          item.context.number === number ? { ...item, target: null } : item,
        ),
      );
    },
    [commit],
  );
  const dismiss = useCallback(() => setEditing(null), []);
  const share = async (next: Annotation[]) => {
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const contexts = next.map((item) => item.context);
      await host.shareAnnotations(contexts);
      if (
        host.sharedAnnotations &&
        !sameAnnotations(host.sharedAnnotations() ?? [], contexts)
      ) {
        sync();
        return false;
      }
      commit(next);
      if (!next.length) nextNumber.current = 1;
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not update the annotations.",
      );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const saveComment = async (number: number, comment: string) => {
    if (lock.current) return false;
    const next = current.current.map((item) => {
      if (item.context.number !== number) return item;
      const selection = { ...item.context.selection };
      delete selection.comment;
      return {
        ...item,
        context: {
          ...item.context,
          selection: { ...selection, ...(comment.trim() ? { comment } : {}) },
        },
      };
    });
    if (
      sameAnnotations(
        next.map((item) => item.context),
        current.current.map((item) => item.context),
      )
    )
      return true;
    return share(next);
  };
  const remove = async (number: number) => {
    if (lock.current) return;
    if (
      await share(
        current.current.filter((item) => item.context.number !== number),
      )
    )
      setEditing(null);
  };
  const add = async () => {
    if (lock.current || !selected) return;
    const latest = readSelection(selected);
    if (!latest) {
      setSelected(null);
      return;
    }
    const context: SelectionAnnotationContext = {
      number: nextNumber.current,
      selection: latest.selection,
      issue: latest.issue,
    };
    const target = annotationTarget(latest);
    const anchor = captureSelectionAnchor(target);
    if (await share([...current.current, { context, target }])) {
      if (anchor) anchors.current.set(context.number, anchor);
      nextNumber.current += 1;
      setEditing(context.number);
      setSelected(null);
      window.getSelection()?.removeAllRanges();
      const active = latest.editable;
      if (active && active.selectionEnd !== null)
        active.setSelectionRange(active.selectionEnd, active.selectionEnd);
    }
  };
  const badgeSlots = new Map<string, number>();
  return (
    <>
      {annotations.map(({ context, target }) => {
        if (!target) return null;
        const rect =
          target.editable?.element.getBoundingClientRect() ??
          target.range?.getClientRects()[0];
        const location = rect
          ? `${Math.round(rect.right)}:${Math.round(rect.top)}`
          : `${context.number}`;
        const badgeOffset = badgeSlots.get(location) ?? 0;
        badgeSlots.set(location, badgeOffset + 1);
        return (
          <SelectionAnnotation
            key={context.number}
            number={context.number}
            target={target}
            badgeOffset={badgeOffset}
            comment={context.selection.comment ?? ""}
            editing={editing === context.number}
            onEdit={() => {
              setError("");
              setEditing(context.number);
            }}
            onDismiss={dismiss}
            busy={busy}
            error={error}
            onSave={saveComment}
            onRemove={remove}
            onInvalid={invalidate}
          />
        );
      })}
      {selected && (
        <div
          className="arco selection-share"
          data-arco-selection-toolbar
          role="toolbar"
          aria-label="Text selection"
          style={{ left: selected.x, top: selected.y }}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button
            ref={addButton}
            color="secondary"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void add()}
          >
            Add to chat
          </Button>
          {error && (
            <span className="selection-share-error" role="alert">
              {error}
            </span>
          )}
        </div>
      )}
    </>
  );
}
