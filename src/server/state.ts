import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { z } from "zod";
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
  draftWriteSchema,
  draftDeleteSchema,
  defaultSettings,
  type DraftKey,
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

export class StateConflict extends Error {
  constructor() {
    super(
      "Another Arco view changed this data. Your input is preserved. Review the latest saved version before saving.",
    );
  }
}

export function createStateStore(directory = stateDirectory()) {
  async function read<T>(
    file: string,
    schema: z.ZodType<T>,
    initial: T,
  ): Promise<T> {
    let content;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return initial;
      throw new Error("Unable to read local settings and drafts.", {
        cause: error,
      });
    }
    try {
      return schema.parse(JSON.parse(content));
    } catch {
      throw new Error(
        "Local settings or drafts do not match the current format. The stored data was preserved without overwriting it.",
      );
    }
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
  const readAnnotations = () => read(annotationsFile, annotationsSchema, {});
  const readSettings = () =>
    read(settingsFile, settingsRecordSchema, {
      revision: 0,
      settings: { ...defaultSettings },
    });
  function draftFile(input: DraftKey) {
    const key = draftKeySchema.parse(input);
    return join(
      directory,
      "drafts",
      `${createHash("sha256").update(JSON.stringify(key)).digest("hex")}.json`,
    );
  }
  const readDraft = (key: DraftKey) =>
    read(draftFile(key), draftRecordSchema, { revision: 0, draft: null });
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
        for (const id of Object.keys(snapshots).slice(0, -100))
          delete snapshots[id];
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
    readSettings,
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
    readDraft,
    async writeDraft(input: z.input<typeof draftWriteSchema>) {
      const data = draftWriteSchema.parse(input);
      return locked(draftFile(data.key), async () => {
        const current = await readDraft(data.key);
        if (current.revision !== data.expectedRevision)
          throw new StateConflict();
        const updated = { revision: current.revision + 1, draft: data.draft };
        await writeAtomic(draftFile(data.key), updated);
        return updated;
      });
    },
    async deleteDraft(input: z.input<typeof draftDeleteSchema>) {
      const data = draftDeleteSchema.parse(input);
      return locked(draftFile(data.key), async () => {
        const current = await readDraft(data.key);
        if (current.revision !== data.expectedRevision)
          throw new StateConflict();
        const updated = { revision: current.revision + 1, draft: null };
        await writeAtomic(draftFile(data.key), updated);
        return updated;
      });
    },
  };
}
