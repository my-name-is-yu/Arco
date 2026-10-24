import type {
  IssueSummary,
  SelectionIssue,
  TextSelectionContext,
  SelectionAnnotationContext,
} from "../shared/contracts";
import type { LinearIssueSummary } from "../shared/linear";
import { selectionIssueSchema } from "./shared-context";
import type { AnnotationTarget } from "./SelectionAnnotation";

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

export function elementFor(node: Node | null) {
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
export type Selected = TextSelectionContext & {
  x: number;
  y: number;
  editable?: Editable;
  editableStart?: number;
  editableEnd?: number;
  editableValue?: string;
  range?: RangeSnapshot;
};
export type Annotation = {
  context: SelectionAnnotationContext;
  target: AnnotationTarget | null;
};

export function sameSelection(
  a: TextSelectionContext,
  b: TextSelectionContext,
) {
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
export function sameAnnotations(
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

export async function annotationHash(context: SelectionAnnotationContext) {
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

export function matchesTargetContext(
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

export function annotationTarget(selected: Selected): AnnotationTarget {
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

export function readSelection(previous?: Selected): Selected | null {
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
