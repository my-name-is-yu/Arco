import type { ArcoHost } from "../shared/contracts";
import type { Draft, DraftKey, DraftRecord } from "../shared/state";
import { draftRecordSchema } from "../shared/state";

type Entry = {
  key: DraftKey;
  record: DraftRecord;
  loaded: boolean;
  conflict: DraftRecord | null;
  tail: Promise<unknown>;
};
export class LocalDraftConflict extends Error {
  constructor(readonly remote: DraftRecord) {
    super(
      "This draft conflicts with another Arco view. Your current input is preserved. Compare it with the saved draft.",
    );
  }
}

/** Small endpoint client. Unsent input stays in UI state; this owns only disk revisions. */
export function createLocalDrafts(host: Pick<ArcoHost, "call">) {
  const entries = new Map<string, Entry>();
  const entryFor = (key: DraftKey) => {
    const id = JSON.stringify(key);
    let entry = entries.get(id);
    if (!entry) {
      entry = {
        key,
        record: { revision: 0, draft: null },
        loaded: false,
        conflict: null,
        tail: Promise.resolve(),
      };
      entries.set(id, entry);
    }
    return entry;
  };
  const read = async (entry: Entry) =>
    draftRecordSchema.parse(
      await host.call("arco_read_draft", { key: entry.key }),
    );
  function load(key: DraftKey) {
    const entry = entryFor(key);
    return queue(entry, async () => {
      if (!entry.loaded) {
        entry.record = await read(entry);
        entry.loaded = true;
      }
      return entry.record;
    });
  }
  function queue<T>(entry: Entry, action: () => Promise<T>) {
    const next = entry.tail.catch(() => undefined).then(action);
    entry.tail = next;
    return next;
  }
  async function save(key: DraftKey, draft: Draft) {
    const entry = entryFor(key);
    return queue(entry, async () => {
      if (!entry.loaded) {
        entry.record = await read(entry);
        entry.loaded = true;
      }
      if (entry.conflict) throw new LocalDraftConflict(entry.conflict);
      try {
        entry.record = draftRecordSchema.parse(
          await host.call("arco_write_draft", {
            key,
            expectedRevision: entry.record.revision,
            draft,
          }),
        );
        return entry.record;
      } catch (error) {
        // A response can be lost after the atomic write. Read, never replay blindly.
        const latest = await read(entry).catch(() => null);
        if (latest && JSON.stringify(latest.draft) === JSON.stringify(draft)) {
          entry.record = latest;
          return latest;
        }
        if (latest && latest.revision !== entry.record.revision) {
          entry.conflict = latest;
          throw new LocalDraftConflict(latest);
        }
        throw error;
      }
    });
  }
  async function resolve(
    key: DraftKey,
    choice: "keep-local" | "use-saved",
    draft?: Draft,
  ) {
    const entry = entryFor(key);
    await entry.tail.catch(() => undefined);
    entry.record = await read(entry);
    entry.loaded = true;
    entry.conflict = null;
    if (choice === "use-saved") return entry.record;
    if (!draft) throw new Error("There is no draft to save.");
    return save(key, draft);
  }
  async function remove(key: DraftKey) {
    const entry = entryFor(key);
    return queue(entry, async () => {
      if (!entry.loaded) {
        entry.record = await read(entry);
        entry.loaded = true;
      }
      if (entry.conflict) throw new LocalDraftConflict(entry.conflict);
      entry.record = draftRecordSchema.parse(
        await host.call("arco_delete_draft", {
          key,
          expectedRevision: entry.record.revision,
        }),
      );
      return entry.record;
    });
  }
  return { load, save, resolve, remove };
}
