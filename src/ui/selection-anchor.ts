import type { AnnotationTarget } from "./SelectionAnnotation";
import { selectionIssueSchema } from "./shared-context";

const rootKinds = [".issue-row", ".detail-pane", ".inline-mode"] as const;
type Point = { path: number[]; offset: number };
export interface SelectionAnchor {
  issueKey: string;
  rootKind: (typeof rootKinds)[number];
  sourceText: string;
  target:
    | { kind: "range"; start: Point; end: Point }
    | {
        kind: "editable";
        path: number[];
        signature: string;
        start: number;
        end: number;
        value: string;
      };
}

function issueKey(root: Element) {
  try {
    const issue = selectionIssueSchema.parse(
      JSON.parse(root.getAttribute("data-arco-issue") ?? "null"),
    );
    return JSON.stringify(
      issue.source === "github"
        ? [issue.source, issue.repo, issue.number, issue.id]
        : [
            issue.source,
            issue.connectionId,
            issue.workspaceId,
            issue.teamId,
            issue.id,
          ],
    );
  } catch {
    return null;
  }
}
function rootFor(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  const root = element?.closest<HTMLElement>("[data-arco-issue]");
  return root?.isConnected ? root : null;
}
function pathFor(root: Node, node: Node): number[] | null {
  const path: number[] = [];
  while (node !== root) {
    const parent = node.parentNode;
    if (!parent) return null;
    path.unshift(
      Array.from(parent.childNodes).findIndex((child) => child === node),
    );
    node = parent;
  }
  return path;
}
function nodeAt(root: Node, path: number[]) {
  let node: Node | undefined = root;
  for (const index of path) node = node?.childNodes[index];
  return node;
}
function signature(element: Element) {
  return JSON.stringify([
    element.tagName,
    ...["type", "aria-label", "name", "id"].map((name) =>
      element.getAttribute(name),
    ),
  ]);
}

export function captureSelectionAnchor(
  target: AnnotationTarget,
): SelectionAnchor | null {
  const input = target.editable;
  const range = target.range;
  const start = input?.element ?? range?.startContainer;
  const end = input?.element ?? range?.endContainer;
  if (!start || !end) return null;
  const root = rootFor(start);
  if (!root || root !== rootFor(end)) return null;
  const rootKind = rootKinds.find((kind) => root.matches(kind));
  const key = issueKey(root);
  const startPath = pathFor(root, start);
  const endPath = pathFor(root, end);
  if (!rootKind || !key || !startPath || !endPath) return null;
  const anchor = { issueKey: key, rootKind, sourceText: target.sourceText };
  if (input)
    return input.element.value === input.value &&
      input.value.slice(input.start, input.end) === target.sourceText
      ? {
          ...anchor,
          target: {
            kind: "editable",
            path: startPath,
            signature: signature(input.element),
            start: input.start,
            end: input.end,
            value: input.value,
          },
        }
      : null;
  return range && range.toString() === target.sourceText
    ? {
        ...anchor,
        target: {
          kind: "range",
          start: { path: startPath, offset: range.startOffset },
          end: { path: endPath, offset: range.endOffset },
        },
      }
    : null;
}

export function restoreSelectionTarget(
  anchor: SelectionAnchor,
): AnnotationTarget | null {
  const roots = Array.from(
    document.querySelectorAll(`[data-arco-issue]${anchor.rootKind}`),
  ).filter((root) => issueKey(root) === anchor.issueKey);
  if (roots.length !== 1) return null;
  const root = roots[0];
  const target = anchor.target;
  if (target.kind === "editable") {
    const element = nodeAt(root, target.path);
    return (element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement) &&
      rootFor(element) === root &&
      signature(element) === target.signature &&
      element.value === target.value &&
      target.value.slice(target.start, target.end) === anchor.sourceText
      ? {
          sourceText: anchor.sourceText,
          editable: {
            element,
            start: target.start,
            end: target.end,
            value: target.value,
          },
        }
      : null;
  }
  const start = nodeAt(root, target.start.path);
  const end = nodeAt(root, target.end.path);
  if (!start || !end || rootFor(start) !== root || rootFor(end) !== root)
    return null;
  try {
    const range = document.createRange();
    range.setStart(start, target.start.offset);
    range.setEnd(end, target.end.offset);
    return range.toString() === anchor.sourceText
      ? { range, sourceText: anchor.sourceText }
      : null;
  } catch {
    return null;
  }
}
