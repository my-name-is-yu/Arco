import { useCallback, useEffect, useRef, useState } from "react";
import type { ArcoHost } from "../shared/contracts";
import { ToolCallError } from "../shared/errors";
import {
  annotationSnapshotSchema,
  type AnnotationSnapshot,
} from "../shared/annotation-state";
import {
  capturePersistableSelectionAnchor,
  type SelectionAnchor,
} from "./selection-anchor";
import {
  sameSelection,
  sameAnnotations,
  annotationHash,
  type Annotation,
} from "./selection-context";

export function useSharedAnnotations(host: ArcoHost, onSync: () => void) {
  const [annotations, setAnnotations] = useState<Annotation[]>(() =>
    (host.sharedAnnotations() ?? []).map((context) => ({
      context,
      target: null,
    })),
  );
  const current = useRef(annotations);
  const anchors = useRef(new Map<number, SelectionAnchor>());
  const persisted = useRef(
    new Map<number, AnnotationSnapshot["anchors"][number]>(),
  );
  const contextChanges = useRef(0);
  const snapshot = useRef(host.annotationSnapshotId());
  const loadedSnapshot = useRef<string | null>(null);
  const [snapshotId, setSnapshotId] = useState(snapshot.current);
  const [restored, setRestored] = useState(0);
  const nextNumber = useRef(
    Math.max(0, ...annotations.map((item) => item.context.number)) + 1,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const commit = useCallback((next: Annotation[]) => {
    current.current = next;
    setAnnotations(next);
    const retained = new Set(next.map((item) => item.context.number));
    for (const number of anchors.current.keys())
      if (!retained.has(number)) anchors.current.delete(number);
    for (const number of persisted.current.keys())
      if (!retained.has(number)) persisted.current.delete(number);
  }, []);
  const sync = useCallback(() => {
    const shared = host.sharedAnnotations() ?? [];
    const nextSnapshot = host.annotationSnapshotId();
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
    onSync();
    nextNumber.current = Math.max(0, ...shared.map((item) => item.number)) + 1;
  }, [host, commit, onSync]);
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
          host.annotationSnapshotId() !== snapshotId
        )
          return;
        if (result?.snapshot === null) return;
        const parsed = annotationSnapshotSchema.safeParse(result?.snapshot);
        if (!parsed.success)
          throw new ToolCallError(
            "invalid-response",
            "Could not restore your selection highlights. Reopen Arco and try again.",
          );
        const saved = parsed.data;
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
  useEffect(
    () =>
      host.subscribe((event) => {
        if (event !== "context") return;
        contextChanges.current += 1;
        if (lock.current) return;
        onSync();
        sync();
        window.getSelection()?.removeAllRanges();
      }),
    [host, sync, onSync],
  );
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
        !sameAnnotations(host.sharedAnnotations() ?? [], contexts) ||
        host.annotationSnapshotId() !== (id ?? null)
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
  return {
    annotations,
    current,
    anchors,
    persisted,
    restored,
    nextNumber,
    busy,
    error,
    setError,
    lock,
    commit,
    share,
  };
}
