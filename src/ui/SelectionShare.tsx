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
import {
  annotationSnapshotSchema,
  type AnnotationSnapshot,
} from "../shared/annotation-state";
import { selectionIssueSchema } from "./shared-context";
import {
  captureSelectionAnchor,
  restoreSelectionTarget,
  capturePersistableSelectionAnchor,
  restorePersistableSelectionTarget,
  type SelectionAnchor,
} from "./selection-anchor";
import {
  SelectionAnnotation,
  measureSelectionAnnotation,
  type AnnotationLayout,
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

async function annotationHash(context: SelectionAnnotationContext) {
  const { number, issue, selection } = context;
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      number,
      issue ?? null,
      selection.text,
      selection.origin,
      selection.commentId ?? null,
    ]),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function matchesTargetContext(
  target: AnnotationTarget,
  context: SelectionAnnotationContext,
) {
  const start =
    target.editable?.element ??
    elementFor(target.range?.startContainer ?? null);
  const end =
    target.editable?.element ?? elementFor(target.range?.endContainer ?? null);
  const region = start?.closest<HTMLElement>(
    "[data-context-origin], [data-linear-context]",
  );
  const origin =
    !target.editable && end && region?.contains(end)
      ? (region.dataset.contextOrigin ?? region.dataset.linearContext)
      : "ui";
  return sameSelection(context, {
    issue: issueFor(start, end),
    selection: {
      ...context.selection,
      origin: origin === "body" || origin === "comment" ? origin : "ui",
      commentId: origin === "comment" ? region?.dataset.commentId : undefined,
    },
  });
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
  const [layouts, setLayouts] = useState(new Map<number, AnnotationLayout>());
  const scheduleLayout = useRef<() => void>(() => undefined);
  const repositionAnnotations = useCallback(() => scheduleLayout.current(), []);
  const anchors = useRef(new Map<number, SelectionAnchor>());
  const persisted = useRef(
    new Map<number, AnnotationSnapshot["anchors"][number]>(),
  );
  const contextChanges = useRef(0);
  const snapshot = useRef(host.annotationSnapshotId?.() ?? null);
  const loadedSnapshot = useRef<string | null>(null);
  const [snapshotId, setSnapshotId] = useState(snapshot.current);
  const [restored, setRestored] = useState(0);
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
    for (const number of persisted.current.keys())
      if (!next.some((item) => item.context.number === number))
        persisted.current.delete(number);
  }, []);
  const capture = useCallback(() => {
    if (lock.current) return;
    setSelected((previous) => readSelection(previous ?? undefined));
    setError("");
  }, []);
  useTextSelection(true, capture);
  const sync = useCallback(() => {
    const shared = host.sharedAnnotations?.() ?? [];
    const nextSnapshot = host.annotationSnapshotId?.() ?? null;
    const sameSnapshot = nextSnapshot === snapshot.current;
    if (
      sameAnnotations(
        current.current.map((item) => item.context),
        shared,
      ) &&
      sameSnapshot
    )
      return;
    commit(
      shared.map((context) => {
        const previous = sameSnapshot
          ? current.current.find(
              (item) =>
                item.context.number === context.number &&
                sameSelection(
                  {
                    ...item.context,
                    selection: {
                      ...item.context.selection,
                      comment: undefined,
                    },
                  },
                  {
                    ...context,
                    selection: { ...context.selection, comment: undefined },
                  },
                ),
            )
          : undefined;
        if (!previous) anchors.current.delete(context.number);
        return { context, target: previous?.target ?? null };
      }),
    );
    if (!sameSnapshot) {
      anchors.current.clear();
      persisted.current.clear();
      loadedSnapshot.current = null;
      snapshot.current = nextSnapshot;
      setSnapshotId(nextSnapshot);
    }
    setEditing(null);
    nextNumber.current = Math.max(0, ...shared.map((item) => item.number)) + 1;
  }, [host, commit]);
  useEffect(() => {
    if (!snapshotId || loadedSnapshot.current === snapshotId) return;
    let cancelled = false;
    void host
      .call<{ snapshot: unknown }>("arco_read_annotation_snapshot", {
        id: snapshotId,
      })
      .then((result) => {
        if (
          cancelled ||
          snapshot.current !== snapshotId ||
          host.annotationSnapshotId?.() !== snapshotId
        )
          return;
        if (result.snapshot === null) return;
        const saved = annotationSnapshotSchema.parse(result.snapshot);
        if (saved.id !== snapshotId)
          throw new Error(
            "The saved annotation positions do not match this attachment.",
          );
        persisted.current = new Map(
          saved.anchors.map((item) => [item.number, item]),
        );
        loadedSnapshot.current = snapshotId;
        setRestored((value) => value + 1);
      })
      .catch((failure) => {
        if (!cancelled)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not restore annotation positions.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [host, snapshotId]);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let pending = false;
    let frame: number | undefined;
    const schedule = () => {
      if (cancelled) return;
      if (running) {
        pending = true;
        return;
      }
      if (frame === undefined)
        frame = requestAnimationFrame(() => {
          frame = undefined;
          void reconnect();
        });
    };
    const reconnect = async () => {
      running = true;
      const original = current.current;
      try {
        const next = await Promise.all(
          original.map(async (item) => {
            const number = item.context.number;
            let target = item.target;
            const input = target?.editable;
            const range = target?.range;
            const valid =
              target &&
              matchesTargetContext(target, item.context) &&
              (input
                ? input.element.isConnected &&
                  input.element.value === input.value
                : range?.startContainer.isConnected &&
                  range.endContainer.isConnected &&
                  range.toString() === target.sourceText);
            if (valid && target) {
              const anchor = captureSelectionAnchor(target);
              if (anchor) anchors.current.set(number, anchor);
              return item;
            }
            const anchor = anchors.current.get(number);
            target = anchor ? restoreSelectionTarget(anchor) : null;
            const saved = persisted.current.get(number);
            if (
              !target &&
              saved &&
              saved.contextHash === (await annotationHash(item.context))
            )
              target = await restorePersistableSelectionTarget(
                saved.anchor,
                item.context.selection.text,
              );
            if (target && !matchesTargetContext(target, item.context))
              target = null;
            return target === item.target ? item : { ...item, target };
          }),
        );
        if (cancelled || current.current !== original) return;
        if (next.some((item, index) => item !== original[index])) commit(next);
        const badgeSlots = new Map<string, number>();
        const badgeOffset = (rect: DOMRect) => {
          const key = `${Math.round(rect.right)}:${Math.round(rect.top)}`;
          const offset = badgeSlots.get(key) ?? 0;
          badgeSlots.set(key, offset + 1);
          return offset;
        };
        const measured = new Map<number, AnnotationLayout>();
        for (const { context, target } of next) {
          if (!target) continue;
          const editor = document.querySelector<HTMLTextAreaElement>(
            `[data-arco-annotation="${context.number}"] .selection-comment textarea`,
          );
          const layout = measureSelectionAnnotation(
            target,
            badgeOffset,
            editor?.offsetHeight,
          );
          if (layout) measured.set(context.number, layout);
        }
        setLayouts((previous) =>
          JSON.stringify([...previous]) === JSON.stringify([...measured])
            ? previous
            : measured,
        );
      } finally {
        running = false;
        if (pending) {
          pending = false;
          schedule();
        }
      }
    };
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            !elementFor(record.target)?.closest(
              "[data-arco-selection-toolbar], .selection-retained-input",
            ),
        )
      )
        schedule();
    });
    scheduleLayout.current = schedule;
    schedule();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "data-arco-issue",
        "data-comment-id",
        "data-context-origin",
        "data-linear-context",
        "class",
        "style",
        "hidden",
        "open",
      ],
    });
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("toggle", schedule, true);
    document.addEventListener("input", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("toggle", schedule, true);
      document.removeEventListener("input", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [commit]);
  useEffect(repositionAnnotations, [
    annotations,
    restored,
    repositionAnnotations,
  ]);
  useEffect(
    () =>
      host.subscribe((event) => {
        if (event !== "context") return;
        contextChanges.current += 1;
        if (lock.current) return;
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
      ) {
        setSelected(null);
        if (!lock.current) setEditing(null);
      }
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
  const dismiss = useCallback(() => setEditing(null), []);
  const share = async (next: Annotation[]) => {
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const contexts = next.map((item) => item.context);
      const before = contextChanges.current;
      const id = next.length ? crypto.randomUUID() : undefined;
      const positions: AnnotationSnapshot["anchors"] = [];
      for (const item of next) {
        const contextHash = await annotationHash(item.context);
        const anchor = item.target
          ? await capturePersistableSelectionAnchor(
              item.target,
              item.context.selection.text,
            )
          : null;
        const previous = persisted.current.get(item.context.number);
        if (anchor)
          positions.push({ number: item.context.number, contextHash, anchor });
        else if (previous?.contextHash === contextHash)
          positions.push(previous);
      }
      if (id)
        await host.call("arco_write_annotation_snapshot", {
          id,
          anchors: positions,
        });
      if (contextChanges.current !== before) {
        sync();
        return false;
      }
      await host.shareAnnotations(contexts, id);
      if (
        host.sharedAnnotations &&
        (!sameAnnotations(host.sharedAnnotations() ?? [], contexts) ||
          (host.annotationSnapshotId &&
            host.annotationSnapshotId() !== (id ?? null)))
      ) {
        sync();
        return false;
      }
      const previousSnapshot = snapshot.current;
      snapshot.current = id ?? null;
      loadedSnapshot.current = id ?? null;
      setSnapshotId(id ?? null);
      persisted.current = new Map(positions.map((item) => [item.number, item]));
      commit(next);
      if (!next.length) nextNumber.current = 1;
      if (!next.length && previousSnapshot)
        await host
          .call("arco_delete_annotation_snapshot", {
            id: previousSnapshot,
          })
          .catch((failure) =>
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not clear saved annotation positions.",
            ),
          );
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
      sync();
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
  return (
    <>
      {annotations.map(({ context, target }) => {
        if (!target) return null;
        const layout = layouts.get(context.number);
        if (!layout) return null;
        return (
          <SelectionAnnotation
            key={context.number}
            number={context.number}
            target={target}
            layout={layout}
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
            onLayoutChange={repositionAnnotations}
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
