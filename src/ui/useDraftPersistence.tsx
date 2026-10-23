import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArcoHost } from "../shared/contracts";
import type { Draft, DraftKey, DraftRecord } from "../shared/state";
import { createLocalDrafts, LocalDraftConflict } from "./local-drafts";

const stores = new WeakMap<ArcoHost, ReturnType<typeof createLocalDrafts>>();
function storeFor(host: ArcoHost) {
  let store = stores.get(host);
  if (!store) {
    store = createLocalDrafts(host);
    stores.set(host, store);
  }
  return store;
}

type Status = {
  state:
    | "idle"
    | "loading"
    | "pending"
    | "saved"
    | "error"
    | "conflict"
    | "resolving";
  error?: string;
  remote?: DraftRecord;
};
export const draftStorageId = (key: DraftKey) => JSON.stringify(key);
export function useDraftPersistence(host: ArcoHost) {
  const store = useMemo(() => storeFor(host), [host]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const pending = useRef(
    new Map<
      string,
      {
        key: DraftKey;
        draft: Draft;
        timer: ReturnType<typeof setTimeout>;
        version: number;
      }
    >(),
  );
  const versions = useRef(new Map<string, number>());
  const mounted = useRef(true);
  const setStatus = useCallback((id: string, status: Status) => {
    if (mounted.current)
      setStatuses((previous) => ({ ...previous, [id]: status }));
  }, []);
  const report = useCallback(
    (id: string, error: unknown) =>
      setStatus(
        id,
        error instanceof LocalDraftConflict
          ? { state: "conflict", error: error.message, remote: error.remote }
          : {
              state: "error",
              error: error instanceof Error ? error.message : String(error),
            },
      ),
    [setStatus],
  );
  const write = useCallback(
    async (key: DraftKey, draft: Draft, version: number) => {
      const id = draftStorageId(key);
      try {
        await store.save(key, draft);
        if (versions.current.get(id) === version)
          setStatus(id, { state: "saved" });
      } catch (error) {
        if (versions.current.get(id) === version) report(id, error);
      }
    },
    [report, setStatus, store],
  );
  const load = useCallback(
    async (key: DraftKey): Promise<Draft | undefined> => {
      const id = draftStorageId(key);
      const version = versions.current.get(id) ?? 0;
      setStatus(id, { state: "loading" });
      try {
        const record = await store.load(key);
        if ((versions.current.get(id) ?? 0) !== version) return undefined;
        setStatus(id, { state: record.draft ? "saved" : "idle" });
        return record.draft ?? undefined;
      } catch (error) {
        if ((versions.current.get(id) ?? 0) === version) report(id, error);
        return undefined;
      }
    },
    [store, setStatus, report],
  );
  const schedule = useCallback(
    (key: DraftKey, draft: Draft) => {
      const id = draftStorageId(key);
      const previous = pending.current.get(id);
      if (previous) clearTimeout(previous.timer);
      const version = (versions.current.get(id) ?? 0) + 1;
      versions.current.set(id, version);
      setStatus(id, { state: "pending" });
      const timer = setTimeout(() => {
        pending.current.delete(id);
        void write(key, draft, version);
      }, 250);
      pending.current.set(id, { key, draft, timer, version });
    },
    [setStatus, write],
  );
  const retry = useCallback(
    (key: DraftKey, draft: Draft) => {
      const id = draftStorageId(key);
      const queued = pending.current.get(id);
      if (queued) clearTimeout(queued.timer);
      pending.current.delete(id);
      const version = (versions.current.get(id) ?? 0) + 1;
      versions.current.set(id, version);
      setStatus(id, { state: "pending" });
      void write(key, draft, version);
    },
    [write, setStatus],
  );
  const resolve = useCallback(
    async (
      key: DraftKey,
      choice: "keep-local" | "use-saved",
      local: Draft,
    ): Promise<Draft | null | undefined> => {
      const id = draftStorageId(key);
      const queued = pending.current.get(id);
      if (queued) clearTimeout(queued.timer);
      pending.current.delete(id);
      const version = (versions.current.get(id) ?? 0) + 1;
      versions.current.set(id, version);
      setStatus(id, { state: "resolving" });
      try {
        const result = await store.resolve(key, choice, local);
        if (versions.current.get(id) !== version) return undefined;
        setStatus(id, { state: "saved" });
        return result.draft;
      } catch (error) {
        report(id, error);
        return undefined;
      }
    },
    [store, setStatus, report],
  );
  const remove = useCallback(
    async (key: DraftKey) => {
      const id = draftStorageId(key);
      const queued = pending.current.get(id);
      if (queued) clearTimeout(queued.timer);
      pending.current.delete(id);
      const version = (versions.current.get(id) ?? 0) + 1;
      versions.current.set(id, version);
      setStatus(id, { state: "pending" });
      try {
        await store.remove(key);
        if (versions.current.get(id) === version)
          setStatus(id, { state: "idle" });
      } catch (error) {
        report(id, error);
      }
    },
    [store, setStatus, report],
  );
  useEffect(() => {
    mounted.current = true;
    const queue = pending.current;
    return () => {
      mounted.current = false;
      for (const entry of queue.values()) {
        clearTimeout(entry.timer);
        void store.save(entry.key, entry.draft).catch(() => undefined);
      }
      queue.clear();
    };
  }, [store]);
  return { statuses, load, schedule, retry, resolve, remove };
}

export function DraftStatus({
  status,
  onRetry,
  onResolve,
}: {
  status?: Status;
  onRetry: () => void;
  onResolve: (choice: "keep-local" | "use-saved") => void;
}) {
  if (!status || status.state === "idle") return null;
  if (status.state === "saved")
    return (
      <p className="draft-storage-status" role="status">
        Draft saved on this device
      </p>
    );
  if (
    status.state === "pending" ||
    status.state === "loading" ||
    status.state === "resolving"
  )
    return (
      <p className="draft-storage-status" role="status">
        {status.state === "loading"
          ? "Checking local draft…"
          : status.state === "resolving"
            ? "Resolving draft conflict…"
            : "Saving draft on this device…"}
      </p>
    );
  return (
    <section className="draft-storage-conflict" role="alert">
      <p>{status.error}</p>
      {status.state === "conflict" ? (
        <details>
          <summary>Compare saved draft</summary>
          {status.remote?.draft ? (
            <>
              <label>
                Saved title
                <input readOnly value={status.remote.draft.title} />
              </label>
              <label>
                Saved body
                <textarea rows={5} readOnly value={status.remote.draft.body} />
              </label>
              <label>
                Saved comment
                <textarea
                  rows={3}
                  readOnly
                  value={status.remote.draft.comment}
                />
              </label>
              {status.remote.draft.promptText && (
                <label>
                  Saved request
                  <textarea
                    rows={3}
                    readOnly
                    value={status.remote.draft.promptText}
                  />
                </label>
              )}
            </>
          ) : (
            <p>There is no saved draft.</p>
          )}
          <div className="editor-actions">
            <button
              type="button"
              className="text-button"
              onClick={() => onResolve("keep-local")}
            >
              Save this screen’s draft
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => onResolve("use-saved")}
            >
              Use saved draft
            </button>
          </div>
        </details>
      ) : (
        <button className="text-button" onClick={onRetry}>
          Retry saving draft
        </button>
      )}
    </section>
  );
}
