import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import {
  createStateStore,
  StateConflict,
  stateDirectory,
} from "../src/server/state";
import { defaultSettings, type DraftKey } from "../src/shared/state";

const directories: string[] = [];
async function temporary() {
  const dir = await mkdtemp(join(tmpdir(), "arco-state-"));
  directories.push(dir);
  return dir;
}
function draftFile(dir: string, key: DraftKey) {
  return join(
    dir,
    "drafts",
    `${createHash("sha256").update(JSON.stringify(key)).digest("hex")}.json`,
  );
}
async function recoveryFiles(file: string) {
  return (await readdir(dirname(file)))
    .filter((name) => name.startsWith(`${basename(file)}.recovery-`))
    .map((name) => join(dirname(file), name));
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("local settings and drafts", () => {
  it("uses OS paths without a developer-specific home", () => {
    expect(stateDirectory("darwin", {}, "/person")).toBe(
      "/person/Library/Application Support/Arco",
    );
    expect(
      stateDirectory("linux", { XDG_STATE_HOME: "/state" }, "/person"),
    ).toBe("/state/arco");
    expect(
      stateDirectory(
        "win32",
        { LOCALAPPDATA: "C:/profile/Local" },
        "C:/profile",
      ),
    ).toContain("Arco");
  });
  it("updates only requested settings and detects competing revisions", async () => {
    const store = createStateStore(await temporary());
    await store.updateSettings({
      expectedRevision: 0,
      patch: { githubRepos: ["yu/Arco"] },
    });
    await expect(
      store.updateSettings({
        expectedRevision: 0,
        patch: { activeSource: "linear" },
      }),
    ).rejects.toBeInstanceOf(StateConflict);
    const next = await store.updateSettings({
      expectedRevision: 1,
      patch: { activeSource: "linear" },
    });
    expect(next.settings.githubRepos).toEqual(["yu/Arco"]);
  });
  it("keeps source/repository draft keys separate and deletion prevents stale revival", async () => {
    const store = createStateStore(await temporary());
    const key = { source: "github" as const, repo: "yu/Arco", issue: "42" };
    const draft = {
      title: "Draft",
      body: "unsaved Markdown",
      comment: "unsent comment",
    };
    await store.writeDraft({ key, expectedRevision: 0, draft });
    expect(
      (await store.readDraft({ ...key, repo: "other/Arco" })).draft,
    ).toBeNull();
    await store.deleteDraft({ key, expectedRevision: 1 });
    await expect(
      store.writeDraft({ key, expectedRevision: 0, draft }),
    ).rejects.toBeInstanceOf(StateConflict);
    expect((await store.readDraft(key)).draft).toBeNull();
  });
  it("persists bounded account filters separately and preserves repositories and revision conflicts", async () => {
    const dir = await temporary();
    const store = createStateStore(dir);
    const filter = {
      filter: "mentioned" as const,
      state: "closed" as const,
      sort: "comments" as const,
      order: "asc" as const,
    };
    await store.updateSettings({
      expectedRevision: 0,
      patch: {
        githubRepos: ["yu/Arco"],
        activeGithubRepo: "yu/Arco",
        githubAccountFilter: filter,
      },
    });
    await store.updateSettings({
      expectedRevision: 1,
      patch: { activeGithubRepo: null },
    });
    const saved = await store.updateSettings({
      expectedRevision: 2,
      patch: { activeSource: "linear" },
    });
    expect(saved.settings.githubAccountFilter).toEqual(filter);
    expect(saved.settings.githubRepos).toEqual(["yu/Arco"]);
    expect(saved.settings.activeGithubRepo).toBeNull();
    await expect(
      store.updateSettings({
        expectedRevision: 2,
        patch: { githubAccountFilter: { ...filter, state: "all" } },
      }),
    ).rejects.toBeInstanceOf(StateConflict);
    await expect(
      store.updateSettings({
        expectedRevision: 3,
        patch: JSON.parse(
          JSON.stringify({ githubAccountFilter: { ...filter, query: "text" } }),
        ),
      }),
    ).rejects.toThrow();
    expect((await createStateStore(dir).readSettings()).settings).toEqual(
      saved.settings,
    );
  });
  it.each([
    { source: "github" as const, repo: "yu/Arco", issue: "42" },
    {
      source: "linear" as const,
      workspaceId: "workspace",
      teamId: "team",
      issue: "issue",
    },
  ])(
    "reloads current drafts and rejects retired stored fields for $source",
    async (key) => {
      const dir = await temporary();
      const store = createStateStore(dir);
      const draft = {
        title: "Title",
        body: "Current body draft",
        comment: "Unsent comment",
      };
      await store.writeDraft({ key, expectedRevision: 0, draft });
      expect((await createStateStore(dir).readDraft(key)).draft).toEqual(draft);
      const file = draftFile(dir, key);
      const stored = JSON.stringify({
        revision: 1,
        draft: { ...draft, promptText: "Retired request" },
      });
      await writeFile(file, stored);
      await expect(store.readDraft(key)).rejects.toThrow("current format");
      await expect(
        store.writeDraft({ key, expectedRevision: 1, draft }),
      ).rejects.toThrow("current format");
      await expect(
        store.deleteDraft({ key, expectedRevision: 1 }),
      ).rejects.toThrow("current format");
      expect(await readFile(file, "utf8")).toBe(stored);
      expect(await recoveryFiles(file)).toEqual([]);
    },
  );
  it.each(["settings", "draft", "annotations"])(
    "preserves invalid %s bytes and refuses to replace them",
    async (kind) => {
      const dir = await temporary();
      const store = createStateStore(dir);
      const key = { source: "github" as const, repo: "yu/Arco", issue: "42" };
      const file =
        kind === "draft" ? draftFile(dir, key) : join(dir, `${kind}.json`);
      await mkdir(dirname(file), { recursive: true });
      const record =
        kind === "settings"
          ? {
              revision: 3,
              settings: { ...defaultSettings, activeLinearTeam: "marker" },
            }
          : kind === "draft"
            ? {
                revision: 3,
                draft: { title: "Title", body: "marker", comment: "" },
              }
            : {};
      const [before, after] = JSON.stringify(record)
        .replace('"marker"', '"invalid-byte-here"')
        .split("invalid-byte-here");
      const cases = [
        Buffer.from("{broken json"),
        Buffer.from(JSON.stringify({ ...record, retiredField: true })),
        Buffer.concat([
          Buffer.from(before),
          Buffer.from([0xff]),
          Buffer.from(after ?? ""),
        ]),
        Buffer.from(
          JSON.stringify({
            revision: -1,
            settings: defaultSettings,
            draft: { body: "Keep writing" },
          }),
        ),
        Buffer.from(
          JSON.stringify({
            revision: 3,
            settings: { ...defaultSettings, retiredPreference: true },
            draft: { title: "Title", body: "Body" },
          }),
        ),
      ];
      const read = () =>
        kind === "settings"
          ? store.readSettings()
          : kind === "draft"
            ? store.readDraft(key)
            : store.readAnnotationSnapshot(
                "00000000-0000-4000-8000-000000000001",
              );
      const write = () =>
        kind === "settings"
          ? store.updateSettings({
              expectedRevision: 3,
              patch: { activeSource: "linear" },
            })
          : kind === "draft"
            ? store.writeDraft({
                key,
                expectedRevision: 3,
                draft: { title: "New", body: "New", comment: "" },
              })
            : store.deleteAnnotationSnapshot(
                "00000000-0000-4000-8000-000000000001",
              );
      for (const original of cases) {
        await writeFile(file, original);
        await expect(read()).rejects.toThrow("current format");
        await expect(write()).rejects.toThrow("current format");
        expect(await readFile(file)).toEqual(original);
        expect(await recoveryFiles(file)).toEqual([]);
      }
    },
  );
  it.each([undefined, -1, "5"])(
    "rejects invalid revision %s without changing the settings file",
    async (revision) => {
      const dir = await temporary();
      const file = join(dir, "settings.json");
      const original = JSON.stringify({ revision, settings: defaultSettings });
      await writeFile(file, original);
      await expect(createStateStore(dir).readSettings()).rejects.toThrow(
        "current format",
      );
      expect(await readFile(file, "utf8")).toBe(original);
    },
  );
  it.each(["missing preferences", "missing account scope"])(
    "rejects old settings with %s without filling in fields",
    async (variant) => {
      const dir = await temporary();
      const file = join(dir, "settings.json");
      const settings: Record<string, unknown> = { ...defaultSettings };
      if (variant === "missing preferences") delete settings.githubFilters;
      else
        settings.githubAccountFilter = {
          state: "closed",
          sort: "comments",
          order: "asc",
        };
      const original = JSON.stringify({ revision: 3, settings });
      await writeFile(file, original);
      await expect(createStateStore(dir).readSettings()).rejects.toThrow(
        "current format",
      );
      expect(await readFile(file, "utf8")).toBe(original);
    },
  );
  it("leaves current settings and deleted draft tombstones untouched", async () => {
    const dir = await temporary();
    const store = createStateStore(dir);
    const settings = await store.updateSettings({
      expectedRevision: 0,
      patch: { activeSource: "linear" },
    });
    const key = { source: "github" as const, repo: "yu/Arco", issue: "42" };
    await store.deleteDraft({ key, expectedRevision: 0 });
    const settingsFile = join(dir, "settings.json");
    const tombstoneFile = draftFile(dir, key);
    const settingsBytes = await readFile(settingsFile);
    const tombstoneBytes = await readFile(tombstoneFile);
    const reloaded = createStateStore(dir);
    expect(await reloaded.readSettings()).toEqual(settings);
    expect(await reloaded.readDraft(key)).toEqual({ revision: 1, draft: null });
    expect(await readFile(settingsFile)).toEqual(settingsBytes);
    expect(await readFile(tombstoneFile)).toEqual(tombstoneBytes);
    expect(await recoveryFiles(settingsFile)).toEqual([]);
    expect(await recoveryFiles(tombstoneFile)).toEqual([]);
  });
  it("rejects retired or unknown incoming fields without creating recovery backups", async () => {
    const dir = await temporary();
    const store = createStateStore(dir);
    const key = { source: "github" as const, repo: "yu/Arco", issue: "42" };
    const draft = { title: "Title", body: "Body", comment: "Comment" };
    await store.updateSettings({ expectedRevision: 0, patch: {} });
    await store.writeDraft({ key, expectedRevision: 0, draft });
    await expect(
      store.updateSettings({
        expectedRevision: 1,
        patch: JSON.parse('{"retiredPreference":true}'),
      }),
    ).rejects.toThrow();
    await expect(
      store.writeDraft({
        key,
        expectedRevision: 1,
        draft: JSON.parse(JSON.stringify({ ...draft, promptText: "Retired" })),
      }),
    ).rejects.toThrow();
    expect((await store.readSettings()).revision).toBe(1);
    expect(await store.readDraft(key)).toEqual({ revision: 1, draft });
    expect(await recoveryFiles(join(dir, "settings.json"))).toEqual([]);
    expect(await recoveryFiles(draftFile(dir, key))).toEqual([]);
  });
  it("serializes two independent processes: exactly one write can use revision zero", async () => {
    const dir = await temporary();
    const output = join(dir, "worker.mjs");
    await build({
      stdin: {
        contents: `import { createStateStore } from './src/server/state'; const s=createStateStore(process.argv[2]); try { await s.updateSettings({expectedRevision:0,patch:{activeGithubRepo:process.argv[3]}}); console.log('saved'); } catch { console.log('conflict'); }`,
        resolveDir: process.cwd(),
        loader: "ts",
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "esm",
      banner: {
        js: `import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);`,
      },
    });
    const run = (repo: string) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [output, dir, repo], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let result = "";
        child.stdout.on("data", (chunk) => {
          result += String(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve(result.trim())
            : reject(new Error("worker failed")),
        );
      });
    expect(
      (await Promise.all([run("yu/Arco"), run("other/Arco")])).sort(),
    ).toEqual(["conflict", "saved"]);
    const record = await createStateStore(dir).readSettings();
    expect(record.revision).toBe(1);
    expect(["yu/Arco", "other/Arco"]).toContain(
      record.settings.activeGithubRepo,
    );
  });
});
