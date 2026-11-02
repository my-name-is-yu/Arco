import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ArcoHost } from "../shared/contracts";
import type { Draft, DraftKey, DraftRecord } from "../shared/state";
import { draftKeySchema } from "../shared/state";
import {
  createLocalDrafts,
  LocalDraftConflict,
  sameDraft,
} from "./local-drafts";
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
  retryChoice?: "keep-local" | "use-saved" | "import-legacy";
  legacy?: { record?: DraftRecord; error?: string; loading?: boolean };
};
type DraftChoice =
  "keep-local" | "use-saved" | "review-legacy" | "import-legacy";
type SourceSnapshot = { title: string; body: string; updatedAt: string };
export const draftStorageId = (key: DraftKey) =>
  JSON.stringify(draftKeySchema.parse(key));
export function draftController(host: ArcoHost) {
  return sessionValue(host, "draft-controller", () => {
    const store = createLocalDrafts(host);
    const cells = new Map<
      string,
      { status: Status | undefined; listeners: Set<() => void> }
    >();
    const cellFor = (id: string) => {
      let cell = cells.get(id);
      if (!cell) {
        cell = { status: undefined, listeners: new Set() };
        cells.set(id, cell);
      }
      return cell;
    };
    const getStatus = (id: string) => cells.get(id)?.status;
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
      const cell = cellFor(id);
      // A fresh snapshot also publishes value changes while status stays pending.
      cell.status = { legacy: cell.status?.legacy, ...status };
      cell.listeners.forEach((listener) => listener());
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
          if (recovered.draft && !sameDraft(recovered.draft, draft))
            throw new LocalDraftConflict(recovered);
        }
        if (versions.get(id) !== version) return;
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
          setStatus(id, {
            state: record.draft ? "saved" : "idle",
            ...(record.legacyAvailable ? { legacy: {} } : {}),
          });
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
      get: getStatus,
      subscribe(id: string, listener: () => void) {
        const cell = cellFor(id);
        cell.listeners.add(listener);
        return () => {
          cell.listeners.delete(listener);
          if (
            !cell.listeners.size &&
            cell.status === undefined &&
            cells.get(id) === cell
          )
            cells.delete(id);
        };
      },
      load,
      value: (key: DraftKey): Draft | undefined =>
        current.get(draftStorageId(key)) ?? undefined,
      schedule(input: DraftKey, draft: Draft) {
        const key = draftKeySchema.parse(input);
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
      retry(
        key: DraftKey,
        draft: Draft,
        snapshot?: SourceSnapshot,
      ): Promise<Draft | null | undefined> {
        const id = draftStorageId(key);
        const status = getStatus(id);
        if (status?.retryChoice)
          return controller.resolve(key, status.retryChoice, draft, snapshot);
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
        choice: DraftChoice,
        local: Draft,
        snapshot?: SourceSnapshot,
      ): Promise<Draft | null | undefined> {
        const id = draftStorageId(key);
        if (choice === "review-legacy") {
          setStatus(id, {
            ...getStatus(id),
            state: getStatus(id)?.state ?? "idle",
            legacy: { ...getStatus(id)?.legacy, loading: true },
          });
          try {
            const record = await store.reviewLegacy(key);
            setStatus(id, {
              ...getStatus(id),
              state: getStatus(id)?.state ?? "idle",
              legacy: { record },
            });
          } catch (error) {
            setStatus(id, {
              ...getStatus(id),
              state: getStatus(id)?.state ?? "idle",
              legacy: {
                error:
                  error instanceof Error
                    ? error.message
                    : "The older draft could not be read.",
              },
            });
          }
          return undefined;
        }
        if (choice === "import-legacy") {
          const older = getStatus(id)?.legacy?.record?.draft;
          if (!older) return undefined;
          if (current.get(id) || pending.has(id)) {
            setStatus(id, {
              ...getStatus(id),
              state: getStatus(id)?.state ?? "idle",
              legacy: {
                ...getStatus(id)?.legacy,
                error:
                  "This account already has input. Keep or remove its draft before importing the older draft.",
              },
            });
            return undefined;
          }
          const version = advance(id);
          setStatus(id, { state: "resolving" });
          try {
            const imported =
              !older.baseUpdatedAt && snapshot
                ? {
                    ...older,
                    baseTitle: older.baseTitle ?? snapshot.title,
                    baseBody: older.baseBody ?? snapshot.body,
                    baseUpdatedAt: snapshot.updatedAt,
                  }
                : older;
            const result = await store.importLegacy(key, imported);
            if (versions.get(id) !== version) return undefined;
            current.set(id, result.draft);
            setStatus(id, { state: "saved", legacy: undefined });
            return result.draft;
          } catch (error) {
            if (versions.get(id) === version)
              report(id, error, "save", "import-legacy");
            return undefined;
          }
        }
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
export function useDraftPersistence(host: ArcoHost, key: DraftKey | null) {
  const controller = useMemo(() => draftController(host), [host]);
  const id = key ? draftStorageId(key) : null;
  const source = useMemo(
    () => ({
      get: () => (id === null ? undefined : controller.get(id)),
      subscribe: (listener: () => void) =>
        id === null ? () => {} : controller.subscribe(id, listener),
    }),
    [controller, id],
  );
  const status = useSyncExternalStore(source.subscribe, source.get);
  useEffect(() => () => controller.flush(), [controller]);
  return {
    status,
    value: controller.value,
    load: controller.load,
    schedule: controller.schedule,
    retry: controller.retry,
    resolve: controller.resolve,
    remove: controller.remove,
  };
}

function SavedDraft({ draft }: { draft: Draft | null | undefined }) {
  return draft ? (
    <>
      <label>
        Saved title
        <input readOnly value={draft.title} />
      </label>
      <label>
        Saved body
        <textarea rows={5} readOnly value={draft.body} />
      </label>
      <label>
        Saved comment
        <textarea rows={3} readOnly value={draft.comment} />
      </label>
    </>
  ) : (
    <p>There is no saved draft.</p>
  );
}

export function DraftStatus({
  status,
  onRetry,
  onResolve,
}: {
  status?: Status;
  onRetry: () => void;
  onResolve: (choice: DraftChoice) => void;
}) {
  if (
    !status ||
    (!status.legacy && status.state !== "error" && status.state !== "conflict")
  )
    return null;
  return (
    <section className="draft-storage-conflict" role="alert">
      {status.legacy && (
        <div>
          <p>
            An older draft has no saved account identity. Review it before
            copying it into this account. The original will be kept.
          </p>
          {status.legacy.error && <p>{status.legacy.error}</p>}
          <button
            type="button"
            className="text-button"
            disabled={status.legacy.loading}
            onClick={() => onResolve("review-legacy")}
          >
            {status.legacy.loading
              ? "Loading older draft…"
              : "Review older draft"}
          </button>
          {status.legacy.record && (
            <details open>
              <DisclosureSummary>Compare older draft</DisclosureSummary>
              <SavedDraft draft={status.legacy.record.draft} />
              <button
                type="button"
                className="text-button"
                disabled={
                  !status.legacy.record.draft || status.state === "resolving"
                }
                onClick={() => onResolve("import-legacy")}
              >
                Import older draft into this account
              </button>
            </details>
          )}
        </div>
      )}
      {(status.state === "error" || status.state === "conflict") && (
        <>
          <p>{status.error}</p>
          {status.state === "conflict" ? (
            <details>
              <DisclosureSummary>Compare saved draft</DisclosureSummary>
              <SavedDraft draft={status.remote?.draft} />
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
              {status.retryChoice === "import-legacy"
                ? "Retry importing older draft"
                : status.operation === "load"
                  ? "Retry loading draft"
                  : status.operation === "delete"
                    ? "Retry removing draft"
                    : "Retry saving draft"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
