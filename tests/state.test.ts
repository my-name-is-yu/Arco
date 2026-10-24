import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import {
  createStateStore,
  StateConflict,
  stateDirectory,
} from "../src/server/state";

const directories: string[] = [];
async function temporary() {
  const dir = await mkdtemp(join(tmpdir(), "arco-state-"));
  directories.push(dir);
  return dir;
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
    "rejects old settings with %s without overwriting them",
    async (variant) => {
      const dir = await temporary();
      const store = createStateStore(dir);
      const original = await store.readSettings();
      const settings: Record<string, unknown> = { ...original.settings };
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
      await expect(store.readSettings()).rejects.toThrow("current format");
      await expect(
        store.updateSettings({
          expectedRevision: 3,
          patch: { activeSource: "linear" },
        }),
      ).rejects.toThrow("current format");
      expect(await readFile(file, "utf8")).toBe(stored);
    },
  );
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
    "reloads current drafts and rejects retired request fields for $source",
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
      const file = join(
        dir,
        "drafts",
        `${createHash("sha256").update(JSON.stringify(key)).digest("hex")}.json`,
      );
      const stored = JSON.stringify({
        revision: 1,
        draft: { ...draft, promptText: "Retired request", promptTarget: "new" },
      });
      await writeFile(file, stored);
      await expect(store.readDraft(key)).rejects.toThrow("current format");
      await expect(
        store.writeDraft({ key, expectedRevision: 1, draft }),
      ).rejects.toThrow("current format");
      expect(await readFile(file, "utf8")).toBe(stored);
    },
  );
  it("preserves corrupt settings instead of treating them as empty and overwriting", async () => {
    const dir = await temporary();
    const file = join(dir, "settings.json");
    await writeFile(file, "{partial");
    await expect(
      createStateStore(dir).updateSettings({
        expectedRevision: 0,
        patch: { githubRepos: [] },
      }),
    ).rejects.toThrow("current format");
    expect(await readFile(file, "utf8")).toBe("{partial");
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
