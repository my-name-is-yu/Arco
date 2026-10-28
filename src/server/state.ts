import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { OperationError } from "../shared/errors";
import {
  annotationSnapshotSchema,
  annotationSnapshotIdSchema,
  type AnnotationSnapshot,
} from "../shared/annotation-state";
import {
  settingsRecordSchema,
  settingsSchema,
  settingsUpdateSchema,
  draftRecordSchema,
  draftKeySchema,
  legacyDraftKeySchema,
  draftWriteSchema,
  draftDeleteSchema,
  defaultSettings,
  type DraftKey,
  type DraftRecord,
  type LegacyDraftKey,
} from "../shared/state";

export function stateDirectory(
  platform = process.platform,
  env = process.env,
  home = homedir(),
) {
  if (env.ARCO_DATA_DIR) return env.ARCO_DATA_DIR;
  if (platform === "win32")
    return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "Arco");
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "Arco");
  return join(env.XDG_STATE_HOME || join(home, ".local", "state"), "arco");
}

export class StateConflict extends OperationError {
  constructor() {
    super(
      "Another Arco view changed this data. Your input is preserved. Review the latest saved version before saving.",
      "conflict",
    );
  }
}

export function createStateStore(directory = stateDirectory()) {
  async function read<T>(
    file: string,
    schema: z.ZodType<T>,
    initial: T,
    kind: "settings" | "draft" | "selection highlights",
  ): Promise<T> {
    let content;
    try {
      content = await readFile(file);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return initial;
      throw new OperationError(
        `Could not read your saved ${kind}. Check storage access and try again.`,
        "storage",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(content),
      );
    } catch {
      // Keep the original bytes even when JSON cannot be decoded.
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new OperationError(
      `Your saved ${kind} could not be opened. ${kind === "draft" ? "It has" : "They have"} been kept unchanged.`,
      "storage",
    );
  }
  async function writeAtomic(file: string, data: unknown) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(data));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  async function locked<T>(file: string, action: () => Promise<T>): Promise<T> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(file, {
      realpath: false,
      retries: { retries: 25, minTimeout: 10, maxTimeout: 60 },
      stale: 10_000,
    });
    try {
      return await action();
    } finally {
      await release();
    }
  }
  const settingsFile = join(directory, "settings.json");
  const annotationsFile = join(directory, "annotations.json");
  const annotationsSchema = z.record(
    annotationSnapshotIdSchema,
    annotationSnapshotSchema,
  );
  const readAnnotations = () =>
    read(annotationsFile, annotationsSchema, {}, "selection highlights");
  const readSettings = () =>
    read(
      settingsFile,
      settingsRecordSchema,
      { revision: 0, settings: { ...defaultSettings } },
      "settings",
    );
  function draftFile(input: DraftKey | LegacyDraftKey) {
    return join(
      directory,
      "drafts",
      `${createHash("sha256")
        .update(
          JSON.stringify(
            ("ownerId" in input ? draftKeySchema : legacyDraftKeySchema).parse(
              input,
            ),
          ),
        )
        .digest("hex")}.json`,
    );
  }
  const emptyDraft: DraftRecord = { revision: 0, draft: null };
  const readDraft = (key: DraftKey | LegacyDraftKey) =>
    read(draftFile(key), draftRecordSchema, emptyDraft, "draft");
  function writeDraftRecord(
    key: DraftKey,
    expectedRevision: number,
    draft: DraftRecord["draft"],
  ) {
    const file = draftFile(key);
    return locked(file, async () => {
      const current = await readDraft(key);
      if (current.revision !== expectedRevision) throw new StateConflict();
      const updated = { revision: current.revision + 1, draft };
      await writeAtomic(file, updated);
      return updated;
    });
  }
  return {
    async readAnnotationSnapshot(id: string) {
      const key = annotationSnapshotIdSchema.parse(id);
      return { snapshot: (await readAnnotations())[key] ?? null };
    },
    async writeAnnotationSnapshot(input: AnnotationSnapshot) {
      const snapshot = annotationSnapshotSchema.parse(input);
      return locked(annotationsFile, async () => {
        const snapshots = await readAnnotations();
        const previous = snapshots[snapshot.id];
        if (previous && JSON.stringify(previous) !== JSON.stringify(snapshot))
          throw new StateConflict();
        snapshots[snapshot.id] = snapshot;
        Object.keys(snapshots)
          .slice(0, -100)
          .forEach((id) => {
            delete snapshots[id];
          });
        await writeAtomic(annotationsFile, snapshots);
        return { saved: true };
      });
    },
    async deleteAnnotationSnapshot(id: string) {
      const key = annotationSnapshotIdSchema.parse(id);
      return locked(annotationsFile, async () => {
        const snapshots = await readAnnotations();
        delete snapshots[key];
        await writeAtomic(annotationsFile, snapshots);
        return { deleted: true };
      });
    },
    readSettings: () => locked(settingsFile, readSettings),
    async updateSettings(input: z.input<typeof settingsUpdateSchema>) {
      const { expectedRevision, patch } = settingsUpdateSchema.parse(input);
      return locked(settingsFile, async () => {
        const current = await readSettings();
        if (current.revision !== expectedRevision) throw new StateConflict();
        const updated = {
          revision: current.revision + 1,
          settings: settingsSchema.parse({ ...current.settings, ...patch }),
        };
        await writeAtomic(settingsFile, updated);
        return updated;
      });
    },
    readDraft: (key: DraftKey | LegacyDraftKey) =>
      locked(draftFile(key), async () => {
        const record = await readDraft(key);
        if (record !== emptyDraft || !("ownerId" in key)) return record;
        const legacy = legacyDraftKeySchema.parse(
          key.source === "github"
            ? { source: key.source, repo: key.repo, issue: key.issue }
            : {
                source: key.source,
                workspaceId: key.workspaceId,
                teamId: key.teamId,
                issue: key.issue,
              },
        );
        try {
          await stat(draftFile(legacy));
          return { ...record, legacyAvailable: true };
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return record;
          throw new OperationError(
            "Could not check for an older draft. Your saved files have been kept unchanged.",
            "storage",
          );
        }
      }),
    async writeDraft(input: z.input<typeof draftWriteSchema>) {
      const data = draftWriteSchema.parse(input);
      return writeDraftRecord(data.key, data.expectedRevision, data.draft);
    },
    async deleteDraft(input: z.input<typeof draftDeleteSchema>) {
      const data = draftDeleteSchema.parse(input);
      return writeDraftRecord(data.key, data.expectedRevision, null);
    },
  };
}
