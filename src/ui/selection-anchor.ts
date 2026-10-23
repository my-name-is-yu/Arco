import type { AnnotationTarget } from "./SelectionAnnotation";
import {
  persistedSelectionAnchorSchema,
  type PersistedSelectionAnchor,
} from "../shared/annotation-state";
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

function snapshotTarget(
  target: AnnotationTarget,
  root: Element,
): Pick<SelectionAnchor, "sourceText" | "target"> | null {
  const input = target.editable;
  const range = target.range;
  const start = input?.element ?? range?.startContainer;
  const end = input?.element ?? range?.endContainer;
  if (!start || !end || !root.contains(start) || !root.contains(end))
    return null;
  const startPath = pathFor(root, start);
  const endPath = pathFor(root, end);
  if (!startPath || !endPath) return null;
  if (input)
    return input.element.value === input.value &&
      input.value.slice(input.start, input.end) === target.sourceText
      ? {
          sourceText: target.sourceText,
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
        sourceText: target.sourceText,
        target: {
          kind: "range",
          start: { path: startPath, offset: range.startOffset },
          end: { path: endPath, offset: range.endOffset },
        },
      }
    : null;
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
  const snapshot = snapshotTarget(target, root);
  return rootKind && key && snapshot
    ? { issueKey: key, rootKind, ...snapshot }
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

async function sha256(text: string) {
  const bytes = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function persistSelectionAnchor(
  anchor: Omit<SelectionAnchor, "rootKind"> & {
    rootKind: PersistedSelectionAnchor["rootKind"];
    rootHash?: string;
  },
  selectedText: string,
): Promise<PersistedSelectionAnchor | null> {
  if (!globalThis.crypto?.subtle) return null;
  const target = anchor.target;
  const result = persistedSelectionAnchorSchema.safeParse({
    issueKey: anchor.issueKey,
    rootKind: anchor.rootKind,
    ...(anchor.rootHash ? { rootHash: anchor.rootHash } : {}),
    selectionHash: await sha256(selectedText),
    target:
      target.kind === "editable"
        ? {
            kind: "editable",
            path: target.path,
            signature: target.signature,
            start: target.start,
            end: target.end,
            valueHash: await sha256(target.value),
          }
        : {
            kind: "range",
            start: target.start,
            end: target.end,
            sourceHash: await sha256(anchor.sourceText),
          },
  });
  return result.success ? result.data : null;
}

function workspaceFor(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  return (
    element?.closest<HTMLElement>(".arco.workspace, .arco.inline-mode") ?? null
  );
}
function workspaceKey(root: Element) {
  return `${root.tagName}:${root.matches(".inline-mode") ? "inline" : "workspace"}:${root.matches(".linear-workspace") ? "linear" : "github"}`;
}
function workspaceSnapshot(root: Element, target: AnnotationTarget) {
  const clone = root.cloneNode(true) as Element;
  const fields = root.querySelectorAll("input, textarea, select");
  clone.querySelectorAll("input, textarea, select").forEach((field, index) => {
    const original = fields[index];
    if (
      original instanceof HTMLInputElement ||
      original instanceof HTMLTextAreaElement ||
      original instanceof HTMLSelectElement
    )
      field.setAttribute(
        "data-arco-field-state",
        JSON.stringify([
          original.value,
          original instanceof HTMLInputElement ? original.checked : null,
        ]),
      );
  });
  const ignored = ".shared-target, .notice, [aria-live], [role='status']";
  const originals = root.querySelectorAll(ignored);
  clone.querySelectorAll(ignored).forEach((element, index) => {
    const original = originals[index];
    const selected = target.editable
      ? original.contains(target.editable.element)
      : target.range?.intersectsNode(original);
    if (!selected) element.remove();
  });
  // Button press animation and React IDs vary across identical view mounts.
  for (const element of clone.querySelectorAll<HTMLElement>("[style]")) {
    element.style.removeProperty("--scale");
    if (!element.getAttribute("style")?.trim())
      element.removeAttribute("style");
  }
  const generatedIds = new Map<string, string>();
  for (const element of clone.querySelectorAll("[id]"))
    for (const token of element.id.match(/_r_[0-9a-z]+_/g) ?? [])
      if (!generatedIds.has(token))
        generatedIds.set(token, `_arco_id_${generatedIds.size}_`);
  for (const element of clone.querySelectorAll("*"))
    for (const name of [
      "id",
      "for",
      "aria-controls",
      "aria-labelledby",
      "aria-describedby",
      "aria-owns",
      "aria-activedescendant",
      "list",
    ]) {
      const value = element.getAttribute(name);
      if (value)
        element.setAttribute(
          name,
          value.replace(
            /_r_[0-9a-z]+_/g,
            (token) => generatedIds.get(token) ?? token,
          ),
        );
    }
  return clone.outerHTML;
}

export async function capturePersistableSelectionAnchor(
  target: AnnotationTarget,
  selectedText: string,
): Promise<PersistedSelectionAnchor | null> {
  const native = captureSelectionAnchor(target);
  if (native) return persistSelectionAnchor(native, selectedText);
  if (!globalThis.crypto?.subtle) return null;
  const start = target.editable?.element ?? target.range?.startContainer;
  const end = target.editable?.element ?? target.range?.endContainer;
  if (!start || !end) return null;
  const root = workspaceFor(start);
  if (!root?.isConnected || root !== workspaceFor(end)) return null;
  const snapshot = snapshotTarget(target, root);
  if (!snapshot) return null;
  const dom = workspaceSnapshot(root, target);
  const persisted = await persistSelectionAnchor(
    {
      ...snapshot,
      issueKey: workspaceKey(root),
      rootKind: ".arco",
      rootHash: await sha256(dom),
    },
    selectedText,
  );
  return root.isConnected && workspaceSnapshot(root, target) === dom
    ? persisted
    : null;
}

export async function restorePersistableSelectionTarget(
  anchor: PersistedSelectionAnchor,
  selectedText: string,
): Promise<AnnotationTarget | null> {
  if (
    !globalThis.crypto?.subtle ||
    (await sha256(selectedText)) !== anchor.selectionHash
  )
    return null;
  const generic = anchor.rootKind === ".arco";
  const roots = Array.from(
    document.querySelectorAll(
      generic
        ? ".arco.workspace, .arco.inline-mode"
        : `[data-arco-issue]${anchor.rootKind}`,
    ),
  ).filter((root) =>
    generic
      ? workspaceKey(root) === anchor.issueKey
      : issueKey(root) === anchor.issueKey,
  );
  if (!generic && roots.length !== 1) return null;
  const matches: AnnotationTarget[] = [];
  for (const root of roots) {
    const target = anchor.target;
    let restored: AnnotationTarget;
    if (target.kind === "editable") {
      const element = nodeAt(root, target.path);
      if (
        !(
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) ||
        (!generic && rootFor(element) !== root) ||
        signature(element) !== target.signature ||
        element.value.slice(target.start, target.end) !== selectedText
      )
        continue;
      const value = element.value;
      if ((await sha256(value)) !== target.valueHash || element.value !== value)
        continue;
      restored = {
        sourceText: selectedText,
        editable: { element, start: target.start, end: target.end, value },
      };
    } else {
      const start = nodeAt(root, target.start.path);
      const end = nodeAt(root, target.end.path);
      if (
        !start ||
        !end ||
        (!generic && (rootFor(start) !== root || rootFor(end) !== root))
      )
        continue;
      try {
        const range = document.createRange();
        range.setStart(start, target.start.offset);
        range.setEnd(end, target.end.offset);
        const sourceText = range.toString();
        if (
          (await sha256(sourceText)) !== target.sourceHash ||
          range.toString() !== sourceText
        )
          continue;
        restored = { range, sourceText };
      } catch {
        continue;
      }
    }
    if (generic) {
      const snapshot = workspaceSnapshot(root, restored);
      if (
        (await sha256(snapshot)) !== anchor.rootHash ||
        workspaceSnapshot(root, restored) !== snapshot
      )
        continue;
    }
    if (root.isConnected && (generic || issueKey(root) === anchor.issueKey))
      matches.push(restored);
  }
  return matches.length === 1 ? matches[0] : null;
}
