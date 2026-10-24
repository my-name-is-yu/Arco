import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureSelectionAnchor,
  restoreSelectionTarget,
  restorePersistableSelectionTarget,
} from "./selection-anchor";
import {
  measureSelectionAnnotation,
  type AnnotationLayout,
} from "./SelectionAnnotation";
import {
  elementFor,
  matchesTargetContext,
  annotationHash,
} from "./selection-context";
import type { useSharedAnnotations } from "./useSharedAnnotations";

export function useAnnotationLayout({
  annotations,
  current,
  anchors,
  persisted,
  restored,
  commit,
}: ReturnType<typeof useSharedAnnotations>) {
  const [layouts, setLayouts] = useState(new Map<number, AnnotationLayout>());
  const scheduleLayout = useRef<() => void>(() => undefined);
  const repositionAnnotations = useCallback(() => scheduleLayout.current(), []);
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
  }, [anchors, commit, current, persisted]);
  useEffect(repositionAnnotations, [
    annotations,
    restored,
    repositionAnnotations,
  ]);
  useEffect(() => {
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
  return { layouts, repositionAnnotations };
}
