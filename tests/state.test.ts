import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
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
async function expectRecoveryBackup(file: string, original: Buffer | string) {
  const backups = await recoveryFiles(file);
  expect(backups).toHaveLength(1);
  expect(basename(backups[0])).toMatch(
    new RegExp(
      `^${basename(file).replaceAll(".", "\\.")}\\.recovery-[a-f0-9-]{36}\\.bak$`,
    ),
  );
  expect(await readFile(backups[0])).toEqual(Buffer.from(original));
  expect((await stat(backups[0])).mode & 0o777).toBe(0o600);
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
  it.each(["missing preferences", "missing account scope"])(
    "recovers old settings with %s while keeping an original backup",
    async (variant) => {
      const dir = await temporary();
      const store = createStateStore(dir);
      const original = await store.readSettings();
      const settings: Record<string, unknown> = {
        ...original.settings,
        githubRepos: ["yu/Arco"],
        activeSource: "linear",
      };
      if (variant === "missing preferences") {
        delete settings.githubFilters;
        delete settings.linearFilters;
        delete settings.projectGithubRepos;
        delete settings.githubAccountFilter;
      } else {
        settings.githubAccountFilter = {
          state: "closed",
          sort: "comments",
          order: "asc",
        };
      }
      const file = join(dir, "settings.json");
      const stored = JSON.stringify({ revision: 3, settings });
      await writeFile(file, stored);
      const recovered = await store.readSettings();
      expect(recovered).toEqual({
        revision: 4,
        settings: {
          ...defaultSettings,
          githubRepos: ["yu/Arco"],
          activeSource: "linear",
          ...(variant === "missing account scope"
            ? {
                githubAccountFilter: {
                  filter: "assigned",
                  state: "closed",
                  sort: "comments",
                  order: "asc",
                },
              }
            : {}),
        },
      });
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(recovered);
      await expectRecoveryBackup(file, stored);
      expect((await store.readSettings()).revision).toBe(4);
      const saved = await store.updateSettings({
        expectedRevision: 4,
        patch: { activeSource: "github" },
      });
      expect(saved.revision).toBe(5);
      await expectRecoveryBackup(file, stored);
    },
  );
  it("keeps valid settings fields and repairs invalid fields individually", async () => {
    const dir = await temporary();
    const file = join(dir, "settings.json");
    const stored = JSON.stringify({
      revision: 9,
      settings: {
        ...defaultSettings,
        githubRepos: ["invalid", "yu/Arco"],
        activeGithubRepo: "yu/Arco",
        projectGithubRepos: {
          ["a".repeat(64)]: "yu/Arco",
          invalid: "yu/Arco",
        },
        activeSource: "retired-source",
        githubAccountFilter: {
          filter: "retired-filter",
          state: "closed",
          sort: "retired-sort",
          order: "asc",
          query: "retired query",
        },
        linearTeams: [
          { workspaceId: "workspace", teamId: "team", name: "Team" },
          { workspaceId: "workspace", name: "Incomplete" },
        ],
        activeLinearTeam: "team",
        githubFilters: {
          "yu/Arco": {
            query: "bug",
            state: "closed",
            sort: "comments",
            order: "asc",
          },
          "other/Arco": {
            query: 42,
            state: "open",
            sort: "updated",
            order: "desc",
          },
        },
        linearFilters: {
          team: {
            query: "bug",
            stateId: "closed",
            assigneeId: "yu",
            labelId: "",
            projectId: "",
            order: "createdAt",
          },
          invalid: { query: "incomplete" },
        },
        retiredPreference: true,
      },
    });
    await writeFile(file, stored);
    const recovered = await createStateStore(dir).readSettings();
    expect(recovered).toEqual({
      revision: 10,
      settings: {
        ...defaultSettings,
        githubRepos: ["yu/Arco"],
        activeGithubRepo: "yu/Arco",
        projectGithubRepos: { ["a".repeat(64)]: "yu/Arco" },
        githubAccountFilter: {
          filter: "assigned",
          state: "closed",
          sort: "updated",
          order: "asc",
        },
        linearTeams: [
          { workspaceId: "workspace", teamId: "team", name: "Team" },
        ],
        activeLinearTeam: "team",
        githubFilters: {
          "yu/Arco": {
            query: "bug",
            state: "closed",
            sort: "comments",
            order: "asc",
          },
        },
        linearFilters: {
          team: {
            query: "bug",
            stateId: "closed",
            assigneeId: "yu",
            labelId: "",
            projectId: "",
            order: "createdAt",
          },
        },
      },
    });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(recovered);
    await expectRecoveryBackup(file, stored);
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
    "reloads current drafts and recovers retired stored fields for $source",
    async (key) => {
      const dir = await temporary();
      const store = createStateStore(dir);
      const draft = {
        title: "Title",
        body: "Current body draft",
        comment: "Unsent comment",
        baseBody: "Original body",
        baseUpdatedAt: "2026-10-24T00:00:00Z",
      };
      await store.writeDraft({ key, expectedRevision: 0, draft });
      expect((await createStateStore(dir).readDraft(key)).draft).toEqual(draft);
      const file = draftFile(dir, key);
      expect(await recoveryFiles(file)).toEqual([]);
      const stored = JSON.stringify({
        revision: 1,
        draft: { ...draft, promptText: "Retired request", promptTarget: "new" },
      });
      await writeFile(file, stored);
      const recovered = await store.readDraft(key);
      expect(recovered).toEqual({ revision: 2, draft });
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(recovered);
      await expectRecoveryBackup(file, stored);
      const saved = await store.writeDraft({
        key,
        expectedRevision: 2,
        draft: { ...draft, comment: "Continued after recovery" },
      });
      expect(saved.revision).toBe(3);
      expect(saved.draft.comment).toBe("Continued after recovery");
      await expectRecoveryBackup(file, stored);
    },
  );
  it("keeps usable draft fields and defaults invalid or missing text", async () => {
    const dir = await temporary();
    const store = createStateStore(dir);
    const key = { source: "github" as const, repo: "yu/Arco", issue: "42" };
    const file = draftFile(dir, key);
    await mkdir(dirname(file), { recursive: true });
    const stored = JSON.stringify({
      revision: 6,
      draft: {
        title: 42,
        body: "Keep my writing",
        githubLabels: ["bug"],
        githubAssignees: false,
        linearTemplateId: "",
        linearDescriptionTouched: false,
        baseBody: "Original body",
        promptText: "Retired request",
      },
    });
    await writeFile(file, stored);
    const recovered = await store.readDraft(key);
    expect(recovered).toEqual({
      revision: 7,
      draft: {
        title: "",
        body: "Keep my writing",
        comment: "",
        githubLabels: ["bug"],
        linearDescriptionTouched: false,
        baseBody: "Original body",
      },
    });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(recovered);
    await expectRecoveryBackup(file, stored);
  });
  it.each([undefined, -1, "5"])(
    "recovers an invalid stored revision %s from revision one",
    async (revision) => {
      const dir = await temporary();
      const file = join(dir, "settings.json");
      const stored = JSON.stringify({ revision, settings: defaultSettings });
      await writeFile(file, stored);
      expect(await createStateStore(dir).readSettings()).toEqual({
        revision: 1,
        settings: defaultSettings,
      });
      await expectRecoveryBackup(file, stored);
    },
  );
  it.each(["settings", "draft"])(
    "backs up exact corrupt %s bytes before resetting to an empty record",
    async (kind) => {
      const dir = await temporary();
      const store = createStateStore(dir);
      const key = { source: "github" as const, repo: "yu/Arco", issue: "42" };
      const file =
        kind === "settings" ? join(dir, "settings.json") : draftFile(dir, key);
      await mkdir(dirname(file), { recursive: true });
      const original = Buffer.from([0x7b, 0x22, 0xff, 0x00, 0x80]);
      await writeFile(file, original);
      const read = () =>
        kind === "settings" ? store.readSettings() : store.readDraft(key);
      const expected =
        kind === "settings"
          ? { revision: 1, settings: defaultSettings }
          : { revision: 1, draft: null };
      expect(await read()).toEqual(expected);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(expected);
      await expectRecoveryBackup(file, original);
      expect(await read()).toEqual(expected);
      await expectRecoveryBackup(file, original);
    },
  );
  it.each(["settings", "draft"])(
    "recovers invalid UTF-8 inside otherwise valid %s JSON before saving again",
    async (kind) => {
      const dir = await temporary();
      const store = createStateStore(dir);
      const key = { source: "github" as const, repo: "yu/Arco", issue: "42" };
      const file =
        kind === "settings" ? join(dir, "settings.json") : draftFile(dir, key);
      await mkdir(dirname(file), { recursive: true });
      const marker = "invalid-byte-here";
      const stored =
        kind === "settings"
          ? {
              revision: 3,
              settings: { ...defaultSettings, activeLinearTeam: marker },
            }
          : {
              revision: 3,
              draft: { title: "Title", body: marker, comment: "" },
            };
      const [before, after] = JSON.stringify(stored).split(marker);
      const original = Buffer.concat([
        Buffer.from(before),
        Buffer.from([0xff]),
        Buffer.from(after),
      ]);
      await writeFile(file, original);
      const recovered =
        kind === "settings"
          ? await store.readSettings()
          : await store.readDraft(key);
      expect(recovered).toEqual(
        kind === "settings"
          ? { revision: 1, settings: defaultSettings }
          : { revision: 1, draft: null },
      );
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(recovered);
      await expectRecoveryBackup(file, original);
      const saved =
        kind === "settings"
          ? await store.updateSettings({
              expectedRevision: 1,
              patch: { activeSource: "linear" },
            })
          : await store.writeDraft({
              key,
              expectedRevision: 1,
              draft: {
                title: "Title",
                body: "Saved after recovery",
                comment: "",
              },
            });
      expect(saved.revision).toBe(2);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(saved);
      await expectRecoveryBackup(file, original);
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
  it.each(["settings", "draft"])(
    "serializes concurrent independent stores recovering %s only once",
    async (kind) => {
      const dir = await temporary();
      const key = { source: "github" as const, repo: "yu/Arco", issue: "42" };
      const file =
        kind === "settings" ? join(dir, "settings.json") : draftFile(dir, key);
      await mkdir(dirname(file), { recursive: true });
      const stored =
        kind === "settings"
          ? JSON.stringify({
              revision: 8,
              settings: { activeSource: "linear" },
            })
          : JSON.stringify({ revision: 8, draft: { body: "Keep my writing" } });
      await writeFile(file, stored);
      const records = await Promise.all(
        Array.from({ length: 6 }, () => {
          const store = createStateStore(dir);
          return kind === "settings"
            ? store.readSettings()
            : store.readDraft(key);
        }),
      );
      expect(records.every((record) => record.revision === 9)).toBe(true);
      for (const record of records) expect(record).toEqual(records[0]);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(records[0]);
      await expectRecoveryBackup(file, stored);
    },
  );
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
