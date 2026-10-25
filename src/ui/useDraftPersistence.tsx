import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ArcoHost } from "../shared/contracts";
import type { Draft, DraftKey, DraftRecord } from "../shared/state";
import { createLocalDrafts, LocalDraftConflict } from "./local-drafts";
import { DisclosureSummary } from "./DisclosureSummary";
import { sessionValue } from "./session-state";

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
  operation?: "load" | "save" | "delete";
  retryChoice?: "keep-local" | "use-saved";
};
export const draftStorageId = (key: DraftKey) => JSON.stringify(key);
export function draftController(host: ArcoHost) {
  return sessionValue(host, "draft-controller", () => {
    const store = createLocalDrafts(host);
    let statuses: Record<string, Status> = {};
    const listeners = new Set<() => void>();
    const pending = new Map<
      string,
      {
        key: DraftKey;
        draft: Draft;
        timer: ReturnType<typeof setTimeout>;
        version: number;
      }
    >();
    const versions = new Map<string, number>();
    const current = new Map<string, Draft | null>();
    const loading = new Map<string, Promise<Draft | undefined>>();
    const failedLoads = new Set<string>();
    const setStatus = (id: string, status: Status) => {
      statuses = { ...statuses, [id]: status };
      listeners.forEach((listener) => listener());
    };
    const report = (
      id: string,
      error: unknown,
      operation: NonNullable<Status["operation"]>,
      retryChoice?: Status["retryChoice"],
    ) =>
      setStatus(
        id,
        error instanceof LocalDraftConflict
          ? {
              state: "conflict",
              error: error.message,
              remote: error.remote,
              operation,
              retryChoice,
            }
          : {
              state: "error",
              error: error instanceof Error ? error.message : String(error),
              operation,
              retryChoice,
            },
      );
    const advance = (id: string) => {
      const queued = pending.get(id);
      if (queued) clearTimeout(queued.timer);
      pending.delete(id);
      const version = (versions.get(id) ?? 0) + 1;
      versions.set(id, version);
      return version;
    };
    const write = async (key: DraftKey, draft: Draft, version: number) => {
      const id = draftStorageId(key);
      try {
        await loading.get(id);
        if (failedLoads.has(id)) {
          const recovered = await store.load(key);
          if (
            recovered.draft &&
            JSON.stringify(recovered.draft) !== JSON.stringify(draft)
          )
            throw new LocalDraftConflict(recovered);
        }
        await store.save(key, draft);
        failedLoads.delete(id);
        if (versions.get(id) === version) {
          setStatus(id, { state: "saved" });
          return draft;
        }
      } catch (error) {
        if (versions.get(id) === version) report(id, error, "save");
      }
    };
    const load = (key: DraftKey): Promise<Draft | undefined> => {
      const id = draftStorageId(key);
      if (current.has(id)) return Promise.resolve(current.get(id) ?? undefined);
      const active = loading.get(id);
      if (active) return active;
      const version = versions.get(id) ?? 0;
      setStatus(id, { state: "loading" });
      const request = store
        .load(key)
        .then((record) => {
          if ((versions.get(id) ?? 0) !== version)
            return current.get(id) ?? undefined;
          failedLoads.delete(id);
          current.set(id, record.draft);
          setStatus(id, { state: record.draft ? "saved" : "idle" });
          return record.draft ?? undefined;
        })
        .catch((error) => {
          failedLoads.add(id);
          if ((versions.get(id) ?? 0) === version) report(id, error, "load");
          return undefined;
        })
        .finally(() => loading.delete(id));
      loading.set(id, request);
      return request;
    };
    const flush = () => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        pending.delete(id);
        void write(entry.key, entry.draft, entry.version);
      }
    };
    const controller = {
      get: () => statuses,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      load,
      value: (key: DraftKey): Draft | undefined =>
        current.get(draftStorageId(key)) ?? undefined,
      schedule(key: DraftKey, draft: Draft) {
        const id = draftStorageId(key);
        const version = advance(id);
        current.set(id, draft);
        setStatus(id, { state: "pending" });
        const timer = setTimeout(() => {
          pending.delete(id);
          void write(key, draft, version);
        }, 250);
        pending.set(id, { key, draft, timer, version });
      },
      retry(key: DraftKey, draft: Draft): Promise<Draft | null | undefined> {
        const id = draftStorageId(key);
        const status = statuses[id];
        if (status?.retryChoice)
          return controller.resolve(key, status.retryChoice, draft);
        if (status?.operation === "load" || status?.state === "loading")
          return load(key);
        if (status?.operation === "delete") return controller.remove(key);
        const version = advance(id);
        current.set(id, draft);
        setStatus(id, { state: "pending" });
        return write(key, draft, version);
      },
      async resolve(
        key: DraftKey,
        choice: "keep-local" | "use-saved",
        local: Draft,
      ): Promise<Draft | null | undefined> {
        const id = draftStorageId(key);
        const version = advance(id);
        setStatus(id, { state: "resolving" });
        try {
          const result = await store.resolve(key, choice, local);
          failedLoads.delete(id);
          if (versions.get(id) !== version) return undefined;
          current.set(id, result.draft);
          setStatus(id, { state: result.draft ? "saved" : "idle" });
          return result.draft;
        } catch (error) {
          if (versions.get(id) === version)
            report(id, error, choice === "use-saved" ? "load" : "save", choice);
          return undefined;
        }
      },
      async remove(key: DraftKey): Promise<null | undefined> {
        const id = draftStorageId(key);
        const version = advance(id);
        current.set(id, null);
        setStatus(id, { state: "pending" });
        try {
          await store.remove(key);
          failedLoads.delete(id);
          if (versions.get(id) === version) {
            setStatus(id, { state: "idle" });
            return null;
          }
        } catch (error) {
          if (versions.get(id) === version) report(id, error, "delete");
        }
      },
      flush,
    };
    return controller;
  });
}
export function useDraftPersistence(host: ArcoHost) {
  const controller = useMemo(() => draftController(host), [host]);
  const statuses = useSyncExternalStore(controller.subscribe, controller.get);
  useEffect(() => () => controller.flush(), [controller]);
  return {
    statuses,
    value: controller.value,
    load: controller.load,
    schedule: controller.schedule,
    retry: controller.retry,
    resolve: controller.resolve,
    remove: controller.remove,
  };
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
  if (!status || (status.state !== "error" && status.state !== "conflict"))
    return null;
  return (
    <section className="draft-storage-conflict" role="alert">
      <p>{status.error}</p>
      {status.state === "conflict" ? (
        <details>
          <DisclosureSummary>Compare saved draft</DisclosureSummary>
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
        <button type="button" className="text-button" onClick={onRetry}>
          {status.operation === "load"
            ? "Retry loading draft"
            : status.operation === "delete"
              ? "Retry removing draft"
              : "Retry saving draft"}
        </button>
      )}
    </section>
  );
}
