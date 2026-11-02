import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArcoHost } from "../src/shared/contracts";
import {
  draftDeleteSchema,
  draftKeySchema,
  draftWriteSchema,
  type Draft,
  type DraftKey,
  type LegacyDraftKey,
} from "../src/shared/state";
import { createStateStore, StateConflict } from "../src/server/state";
import { contentConflict } from "../src/ui/content-drafts";
import {
  draftController,
  draftStorageId,
  DraftStatus,
} from "../src/ui/useDraftPersistence";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const draft: Draft = {
  title: "Older private title",
  body: "Older private body",
  comment: "Older private comment",
  githubLabels: ["bug"],
  githubAssignees: ["person"],
  githubChildRepo: "yu/Child",
  githubIssueTypeName: "Bug",
  linearTemplateId: "template",
  linearDescriptionTouched: true,
  linearReplyTo: "reply",
  baseTitle: "Original title",
  baseBody: "Original body",
  baseUpdatedAt: "2026-10-26T00:00:00Z",
};
const scopes: LegacyDraftKey[] = [
  ...["42", "new", "42:comment:7", "child:42"].map((issue) => ({
    source: "github" as const,
    repo: "yu/Arco",
    issue,
  })),
  ...["issue-42", "new", "issue-42:comment:7", "child:issue-42"].map(
    (issue) => ({
      source: "linear" as const,
      workspaceId: "workspace",
      teamId: "team",
      issue,
    }),
  ),
];
const github = { source: "github" as const, repo: "yu/Arco", issue: "42" };
const owned = (key: LegacyDraftKey, ownerId = "owner-a"): DraftKey => ({
  ...key,
  ownerId,
});
async function source() {
  const directory = await mkdtemp(join(tmpdir(), "arco-owned-drafts-"));
  directories.push(directory);
  const store = createStateStore(directory);
  const call = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "arco_read_draft")
      return store.readDraft(args.key as DraftKey | LegacyDraftKey);
    if (name === "arco_write_draft")
      return store.writeDraft(draftWriteSchema.parse(args));
    if (name === "arco_delete_draft")
      return store.deleteDraft(draftDeleteSchema.parse(args));
    throw new Error(`Unexpected local tool: ${name}`);
  });
  return { directory, store, call, host: { call } as unknown as ArcoHost };
}
async function seedLegacy(
  directory: string,
  key: LegacyDraftKey = github,
  content = JSON.stringify({ revision: 4, draft }),
) {
  const path = join(
    directory,
    "drafts",
    `${createHash("sha256").update(JSON.stringify(key)).digest("hex")}.json`,
  );
  await mkdir(join(directory, "drafts"), { recursive: true });
  await writeFile(path, content, { mode: 0o600 });
  return { path, bytes: await readFile(path) };
}

describe("stable account ownership of local drafts", () => {
  it.each(scopes)(
    "separates owners for $source $issue and keeps the same owner's key stable",
    async (key) => {
      const { store } = await source();
      const a = owned(key);
      const b = owned(key, "owner-b");
      await store.writeDraft({ key: a, expectedRevision: 0, draft });
      expect(await store.readDraft(b)).toEqual({ revision: 0, draft: null });
      await store.writeDraft({
        key: b,
        expectedRevision: 0,
        draft: { ...draft, body: "B's own input" },
      });
      expect((await store.readDraft(a)).draft).toEqual(draft);
      expect((await store.readDraft(b)).draft?.body).toBe("B's own input");
      expect(draftKeySchema.parse({ ...a })).toEqual(a);
      await expect(
        store.writeDraft({ key: a, expectedRevision: 0, draft }),
      ).rejects.toBeInstanceOf(StateConflict);
    },
  );

  it("keeps unowned keys read-only and leaves legacy bytes intact", async () => {
    const { directory, store } = await source();
    const legacy = await seedLegacy(directory);
    const result = await store.readDraft(owned(github));
    expect(result).toEqual({ revision: 0, draft: null, legacyAvailable: true });
    expect(JSON.stringify(result)).not.toContain(draft.body);
    expect((await store.readDraft(github)).draft).toEqual(draft);
    expect(() =>
      draftWriteSchema.parse({ key: github, expectedRevision: 4, draft }),
    ).toThrow();
    expect(() =>
      draftDeleteSchema.parse({ key: github, expectedRevision: 4 }),
    ).toThrow();
    await store.writeDraft({
      key: owned(github),
      expectedRevision: 0,
      draft: { ...draft, body: "Owned input" },
    });
    expect(await readFile(legacy.path)).toEqual(legacy.bytes);
    expect(await store.readDraft(owned(github))).not.toHaveProperty(
      "legacyAvailable",
    );
    await store.deleteDraft({ key: owned(github), expectedRevision: 1 });
    expect(await store.readDraft(owned(github))).toEqual({
      revision: 2,
      draft: null,
    });
  });

  it("captures the queued owner's key before a later account switch and flush", async () => {
    const { store, host } = await source();
    const controller = draftController(host);
    const a = owned(github);
    const mutable = { ...a };
    const b = owned(github, "owner-b");
    controller.schedule(mutable, draft);
    mutable.ownerId = "owner-b";
    controller.schedule(b, { ...draft, body: "B's queued input" });
    controller.flush();
    await vi.waitFor(async () => {
      expect((await store.readDraft(a)).draft).toEqual(draft);
      expect((await store.readDraft(b)).draft?.body).toBe("B's queued input");
    });
    expect(controller.value(a)).toEqual(draft);
    expect(controller.value(b)?.body).toBe("B's queued input");
  });

  it("reviews legacy content only on request and explicitly imports all fields without deleting the original", async () => {
    const { directory, store, host, call } = await source();
    const legacy = await seedLegacy(directory);
    const key = owned(github);
    const controller = draftController(host);
    await expect(controller.load(key)).resolves.toBeUndefined();
    const markup = () =>
      renderToStaticMarkup(
        createElement(DraftStatus, {
          status: controller.get(draftStorageId(key)),
          onRetry() {},
          onResolve() {},
        }),
      );
    expect(markup()).toContain("Review older draft");
    expect(markup()).not.toContain(draft.body);
    expect(call.mock.calls).toHaveLength(1);
    await controller.resolve(key, "review-legacy", draft);
    expect(controller.value(key)).toBeUndefined();
    expect(markup()).toContain(draft.body);
    expect(
      call.mock.calls.filter(([name]) => name === "arco_write_draft"),
    ).toHaveLength(0);
    await expect(
      controller.resolve(key, "import-legacy", draft),
    ).resolves.toEqual(draft);
    expect((await store.readDraft(key)).draft).toEqual(draft);
    expect(await readFile(legacy.path)).toEqual(legacy.bytes);
  });

  it("preserves new input and refuses to import over a concurrent owned draft", async () => {
    const { directory, store, host } = await source();
    const legacy = await seedLegacy(directory);
    const key = owned(github);
    const controller = draftController(host);
    await controller.load(key);
    await controller.resolve(key, "review-legacy", draft);
    await store.writeDraft({
      key,
      expectedRevision: 0,
      draft: { ...draft, body: "Other view's owned input" },
    });
    await controller.resolve(key, "import-legacy", draft);
    expect(controller.get(draftStorageId(key))?.state).toBe("conflict");
    expect((await store.readDraft(key)).draft?.body).toBe(
      "Other view's owned input",
    );
    expect(await readFile(legacy.path)).toEqual(legacy.bytes);
  });

  it("does not replace current queued input when the older draft is imported", async () => {
    const { directory, store, host } = await source();
    await seedLegacy(directory);
    const key = owned(github);
    const controller = draftController(host);
    await controller.load(key);
    await controller.resolve(key, "review-legacy", draft);
    controller.schedule(key, { ...draft, body: "New input" });
    await controller.resolve(key, "import-legacy", draft);
    expect(controller.value(key)?.body).toBe("New input");
    expect(controller.get(draftStorageId(key))?.legacy?.error).toContain(
      "already has input",
    );
    controller.flush();
    await vi.waitFor(async () =>
      expect((await store.readDraft(key)).draft?.body).toBe("New input"),
    );
  });

  it("explicitly imports an older draft after removing owned input without changing the original", async () => {
    const { directory, store, host } = await source();
    const legacy = await seedLegacy(directory);
    const key = owned(github);
    const controller = draftController(host);
    await controller.load(key);
    controller.schedule(key, { ...draft, body: "Owned input to remove" });
    controller.flush();
    await vi.waitFor(async () =>
      expect((await store.readDraft(key)).draft?.body).toBe(
        "Owned input to remove",
      ),
    );
    await controller.remove(key);
    expect(await store.readDraft(key)).toEqual({ revision: 2, draft: null });
    expect(controller.value(key)).toBeUndefined();
    await controller.resolve(key, "review-legacy", draft);
    await expect(
      controller.resolve(key, "import-legacy", draft),
    ).resolves.toEqual(draft);
    expect(await store.readDraft(key)).toEqual({ revision: 3, draft });
    expect(await readFile(legacy.path)).toEqual(legacy.bytes);
  });

  it("exposes malformed legacy records only on review and preserves their exact bytes", async () => {
    const { directory, store, host } = await source();
    const legacy = await seedLegacy(
      directory,
      github,
      "{bad older draft bytes",
    );
    const key = owned(github);
    const controller = draftController(host);
    await controller.load(key);
    expect(controller.get(draftStorageId(key))?.legacy).toEqual({});
    await controller.resolve(key, "review-legacy", draft);
    expect(controller.get(draftStorageId(key))?.legacy?.error).toContain(
      "kept unchanged",
    );
    expect(controller.value(key)).toBeUndefined();
    expect(await readFile(legacy.path)).toEqual(legacy.bytes);
    expect((await store.readDraft(key)).draft).toBeNull();
  });

  it.each([
    github,
    {
      source: "linear" as const,
      workspaceId: "workspace",
      teamId: "team",
      issue: "issue-42",
    },
  ])(
    "uses the actual current $source content as an import baseline only when the old baseline is missing",
    async (native) => {
      const { directory, store, host } = await source();
      const raw = { ...draft };
      delete raw.baseTitle;
      delete raw.baseBody;
      delete raw.baseUpdatedAt;
      const legacy = await seedLegacy(
        directory,
        native,
        JSON.stringify({ revision: 4, draft: raw }),
      );
      const key = owned(native);
      const controller = draftController(host);
      await controller.load(key);
      await controller.resolve(key, "review-legacy", raw);
      const snapshot = {
        title: "Current source title",
        body: "Current source body",
        updatedAt: "2026-10-26T01:00:00Z",
      };
      const imported = await controller.resolve(
        key,
        "import-legacy",
        raw,
        snapshot,
      );
      expect(imported).toEqual({
        ...raw,
        baseTitle: snapshot.title,
        baseBody: snapshot.body,
        baseUpdatedAt: snapshot.updatedAt,
      });
      expect((await store.readDraft(key)).draft).toEqual(imported);
      expect(contentConflict(snapshot, imported!)).toBe(false);
      expect(
        contentConflict(
          { ...snapshot, body: "A later source edit" },
          imported!,
        ),
      ).toBe(true);
      expect(await readFile(legacy.path)).toEqual(legacy.bytes);
    },
  );

  it("confirms a committed deletion after a lost acknowledgement and saves the next input without a stale revision", async () => {
    const { directory, store, host, call } = await source();
    const legacy = await seedLegacy(directory);
    const key = owned(github);
    await store.writeDraft({ key, expectedRevision: 0, draft });
    const controller = draftController(host);
    await controller.load(key);
    const endpoint = call.getMockImplementation()!;
    let loseResponse = true;
    call.mockImplementation(async (name, args) => {
      const result = await endpoint(name, args);
      if (name === "arco_delete_draft" && loseResponse) {
        loseResponse = false;
        throw new Error("The deletion acknowledgement was lost.");
      }
      return result;
    });
    await expect(controller.remove(key)).resolves.toBeNull();
    expect(controller.get(draftStorageId(key))?.state).toBe("idle");
    expect(await store.readDraft(key)).toEqual({ revision: 2, draft: null });
    expect(call.mock.calls.map(([name]) => name)).toEqual([
      "arco_read_draft",
      "arco_delete_draft",
      "arco_read_draft",
    ]);

    const next = { ...draft, comment: "New input after deletion" };
    controller.schedule(key, next);
    controller.flush();
    await vi.waitFor(() =>
      expect(controller.get(draftStorageId(key))?.state).toBe("saved"),
    );
    expect(await store.readDraft(key)).toEqual({ revision: 3, draft: next });
    expect(await readFile(legacy.path)).toEqual(legacy.bytes);
  });

  it("verifies an imported draft after a lost write acknowledgement without replaying the save", async () => {
    const { directory, store, host, call } = await source();
    const legacy = await seedLegacy(directory);
    const key = owned(github);
    const controller = draftController(host);
    await controller.load(key);
    await controller.resolve(key, "review-legacy", draft);
    const endpoint = call.getMockImplementation()!;
    let loseResponse = true;
    call.mockImplementation(async (name, args) => {
      const result = await endpoint(name, args);
      if (name === "arco_write_draft" && loseResponse) {
        loseResponse = false;
        throw new Error("The write acknowledgement was lost.");
      }
      return result;
    });
    await expect(
      controller.resolve(key, "import-legacy", draft),
    ).resolves.toEqual(draft);
    expect(
      call.mock.calls.filter(([name]) => name === "arco_write_draft"),
    ).toHaveLength(1);
    expect((await store.readDraft(key)).draft).toEqual(draft);
    expect(await readFile(legacy.path)).toEqual(legacy.bytes);
  });
});
