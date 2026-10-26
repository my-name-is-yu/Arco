import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { useQueryClient } from "@tanstack/react-query";
import type { ArcoHost, SelectionAnnotationContext } from "../shared/contracts";
import { captureSelectionAnchor } from "./selection-anchor";
import { SelectionAnnotation } from "./SelectionAnnotation";
import {
  sameAnnotations,
  annotationTarget,
  readSelection,
  elementFor,
  type Selected,
} from "./selection-context";
import { useSharedAnnotations } from "./useSharedAnnotations";
import { useAnnotationLayout } from "./useAnnotationLayout";
import { isGitHubAuthScope } from "./github-auth";

type CapturedSelection = Selected & { githubAuthScope?: string };

export function SelectionShare({ host }: { host: ArcoHost }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<CapturedSelection | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const onSync = useCallback(() => {
    setSelected(null);
    setEditing(null);
  }, []);
  const controller = useSharedAnnotations(host, onSync);
  const {
    annotations,
    current,
    anchors,
    nextNumber,
    busy,
    error,
    setError,
    lock,
    share,
  } = controller;
  const { layouts, repositionAnnotations } = useAnnotationLayout(controller);
  const addButton = useRef<HTMLButtonElement>(null);
  const capture = useCallback(() => {
    if (lock.current) return;
    // Save visible text before later layout reads can change Selection.toString().
    const next = readSelection(selected ?? undefined);
    const element =
      next?.editable ?? elementFor(next?.range?.startContainer ?? null);
    setSelected(
      next
        ? {
            ...next,
            githubAuthScope:
              next.issue?.source === "github"
                ? element?.closest<HTMLElement>(
                    "[data-arco-github-auth-generation]",
                  )?.dataset.arcoGithubAuthGeneration
                : undefined,
          }
        : null,
    );
    setError("");
  }, [lock, selected, setError]);
  useEffect(() => {
    const selectionchange = () => {
      if (!lock.current)
        setSelected((previous) => {
          const next = previous ? readSelection(previous) : null;
          return next
            ? { ...next, githubAuthScope: previous?.githubAuthScope }
            : null;
        });
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
      if (event.key === "Escape") {
        setSelected(null);
        return;
      }
      if (
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
      setSelected((previous) => {
        const next = previous ? readSelection(previous) : null;
        return next
          ? { ...next, githubAuthScope: previous?.githubAuthScope }
          : null;
      });
    document.addEventListener("selectionchange", selectionchange);
    document.addEventListener("mouseup", capture);
    document.addEventListener("select", capture);
    document.addEventListener("keyup", keyup);
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", pointerdown);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("selectionchange", selectionchange);
      document.removeEventListener("mouseup", capture);
      document.removeEventListener("select", capture);
      document.removeEventListener("keyup", keyup);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", pointerdown);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", reposition);
    };
  }, [capture, lock]);
  const dismiss = useCallback(() => setEditing(null), []);
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
    const canShare = () =>
      selected.issue?.source !== "github" ||
      Boolean(
        selected.githubAuthScope &&
        isGitHubAuthScope(client, selected.githubAuthScope),
      );
    if (!canShare()) {
      setError(
        "GitHub authentication changed. Select the text again before sharing it.",
      );
      return;
    }
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
    if (await share([...current.current, { context, target }], canShare)) {
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
        return (
          <SelectionAnnotation
            key={context.number}
            number={context.number}
            target={target}
            layout={layouts.get(context.number) ?? null}
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
