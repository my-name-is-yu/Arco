import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  draftController,
  draftStorageId,
  DraftStatus,
} from "../src/ui/useDraftPersistence";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStateStore } from "../src/server/state";
import type { ArcoHost } from "../src/shared/contracts";
import type { Draft, DraftKey, DraftRecord } from "../src/shared/state";

const github: DraftKey = { source: "github", repo: "yu/Arco", issue: "42" };
const linear: DraftKey = {
  source: "linear",
  workspaceId: "workspace",
  teamId: "team",
  issue: "issue-42",
};
const draft = (comment: string): Draft => ({
  title: "Title",
  body: "Body",
  comment,
});
function fixture() {
  const saved = new Map<string, Draft>();
  const call = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const id = JSON.stringify(args.key);
    if (name === "arco_write_draft") saved.set(id, args.draft as Draft);
    return {
      revision: name === "arco_write_draft" ? 1 : 0,
      draft: saved.get(id) ?? null,
    };
  });
  return { host: { call } as unknown as ArcoHost, call };
}
function recoveringSource(initial: DraftRecord) {
  let record = structuredClone(initial);
  const controls = { readFails: false, writeFails: false, deleteFails: false };
  const call = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "arco_read_draft") {
      if (controls.readFails) throw new Error("Draft loading is unavailable.");
      return structuredClone(record);
    }
    if (name === "arco_write_draft" && controls.writeFails)
      throw new Error("Draft saving is unavailable.");
    if (name === "arco_delete_draft" && controls.deleteFails)
      throw new Error("Draft removal is unavailable.");
    expect(args.expectedRevision).toBe(record.revision);
    record = {
      revision: record.revision + 1,
      draft: name === "arco_delete_draft" ? null : (args.draft as Draft),
    };
    return structuredClone(record);
  });
  return {
    host: { call } as unknown as ArcoHost,
    call,
    controls,
    record: () => record,
  };
}
describe("host-lifetime draft controller", () => {
  it("retries a failed load by restoring saved content without writing the supplied default draft", async () => {
    const source = recoveringSource({
      revision: 3,
      draft: draft("Saved text"),
    });
    source.controls.readFails = true;
    const controller = draftController(source.host);
    await controller.load(github);
    expect(controller.get()[draftStorageId(github)]).toMatchObject({
      state: "error",
      operation: "load",
    });
    source.controls.readFails = false;
    await expect(controller.retry(github, draft(""))).resolves.toEqual(
      draft("Saved text"),
    );
    expect(controller.value(github)).toEqual(draft("Saved text"));
    expect(source.call.mock.calls.map(([name]) => name)).toEqual([
      "arco_read_draft",
      "arco_read_draft",
    ]);
    expect(source.record()).toEqual({
      revision: 3,
      draft: draft("Saved text"),
    });
  });

  it("keeps edits made after a failed load and compares recovered saved content before writing", async () => {
    const source = recoveringSource({
      revision: 3,
      draft: draft("Saved text"),
    });
    source.controls.readFails = true;
    const controller = draftController(source.host);
    await controller.load(github);
    controller.schedule(github, draft("New input"));
    source.controls.readFails = false;
    controller.flush();
    await vi.waitFor(() =>
      expect(controller.get()[draftStorageId(github)]).toMatchObject({
        state: "conflict",
        remote: { revision: 3, draft: draft("Saved text") },
      }),
    );
    expect(controller.value(github)).toEqual(draft("New input"));
    expect(source.record().draft).toEqual(draft("Saved text"));
    expect(
      source.call.mock.calls.every(([name]) => name === "arco_read_draft"),
    ).toBe(true);
    await controller.resolve(github, "keep-local", draft("New input"));
    expect(source.record()).toEqual({ revision: 4, draft: draft("New input") });
    expect(controller.get()[draftStorageId(github)]?.state).toBe("saved");
  });

  it("does not replace newer input when a retried load finishes late", async () => {
    const source = recoveringSource({
      revision: 3,
      draft: draft("Saved text"),
    });
    source.controls.readFails = true;
    const controller = draftController(source.host);
    await controller.load(github);
    let release!: (value: DraftRecord) => void;
    source.call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const retry = controller.retry(github, draft(""));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    controller.schedule(github, draft("Typed during retry"));
    release({ revision: 3, draft: draft("Saved text") });
    await retry;
    expect(controller.value(github)).toEqual(draft("Typed during retry"));
    expect(source.call.mock.calls.map(([name]) => name)).toEqual([
      "arco_read_draft",
      "arco_read_draft",
    ]);
    controller.flush();
    await vi.waitFor(() =>
      expect(controller.get()[draftStorageId(github)]?.state).toBe("conflict"),
    );
    expect(source.record().draft).toEqual(draft("Saved text"));
  });

  it("compares recovered saved content when typing precedes a delayed initial load failure", async () => {
    const source = recoveringSource({
      revision: 3,
      draft: draft("Saved text"),
    });
    let rejectRead!: (error: Error) => void;
    source.call.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    const controller = draftController(source.host);
    const loading = controller.load(github);
    await vi.waitFor(() => expect(rejectRead).toBeTypeOf("function"));
    controller.schedule(github, draft("Typed before failure"));
    controller.flush();
    rejectRead(new Error("Draft loading is unavailable."));
    await loading;
    await vi.waitFor(() =>
      expect(controller.get()[draftStorageId(github)]?.state).toBe("conflict"),
    );
    expect(controller.value(github)).toEqual(draft("Typed before failure"));
    expect(source.record().draft).toEqual(draft("Saved text"));
    expect(
      source.call.mock.calls.every(([name]) => name === "arco_read_draft"),
    ).toBe(true);
  });

  it("retries a failed save only on request and preserves the edited draft", async () => {
    const source = recoveringSource({ revision: 0, draft: null });
    const controller = draftController(source.host);
    await controller.load(github);
    source.controls.writeFails = true;
    controller.schedule(github, draft("New input"));
    controller.flush();
    await vi.waitFor(() =>
      expect(controller.get()[draftStorageId(github)]).toMatchObject({
        state: "error",
        operation: "save",
      }),
    );
    expect(controller.value(github)).toEqual(draft("New input"));
    expect(
      source.call.mock.calls.filter(([name]) => name === "arco_write_draft"),
    ).toHaveLength(1);
    source.controls.writeFails = false;
    await controller.retry(github, draft("New input"));
    expect(source.record().draft).toEqual(draft("New input"));
    expect(
      source.call.mock.calls.filter(([name]) => name === "arco_write_draft"),
    ).toHaveLength(2);
    expect(controller.get()[draftStorageId(github)]?.state).toBe("saved");
  });

  it("retries a failed removal without saving a replacement draft", async () => {
    const source = recoveringSource({
      revision: 3,
      draft: draft("Saved text"),
    });
    const controller = draftController(source.host);
    await controller.load(github);
    source.controls.deleteFails = true;
    await controller.remove(github);
    expect(controller.get()[draftStorageId(github)]).toMatchObject({
      state: "error",
      operation: "delete",
    });
    source.controls.deleteFails = false;
    await controller.retry(github, draft(""));
    expect(source.record()).toEqual({ revision: 4, draft: null });
    expect(
      source.call.mock.calls.some(([name]) => name === "arco_write_draft"),
    ).toBe(false);
    expect(controller.get()[draftStorageId(github)]?.state).toBe("idle");
  });

  it("retries a failed saved-draft comparison choice without replacing it with local input", async () => {
    const source = recoveringSource({
      revision: 3,
      draft: draft("Saved text"),
    });
    source.controls.readFails = true;
    const controller = draftController(source.host);
    await controller.load(github);
    controller.schedule(github, draft("New input"));
    source.controls.readFails = false;
    controller.flush();
    await vi.waitFor(() =>
      expect(controller.get()[draftStorageId(github)]?.state).toBe("conflict"),
    );
    source.controls.readFails = true;
    await controller.resolve(github, "use-saved", draft("New input"));
    source.controls.readFails = false;
    await controller.retry(github, draft("New input"));
    expect(controller.value(github)).toEqual(draft("Saved text"));
    expect(
      source.call.mock.calls.every(([name]) => name === "arco_read_draft"),
    ).toBe(true);
  });

  it("preserves a retired disk draft and keeps new input in memory when loading fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arco-draft-invalid-"));
    try {
      const store = createStateStore(directory);
      await store.writeDraft({
        key: github,
        expectedRevision: 0,
        draft: draft("Unsent legacy comment"),
      });
      const file = join(
        directory,
        "drafts",
        `${createHash("sha256").update(JSON.stringify(github)).digest("hex")}.json`,
      );
      await writeFile(
        file,
        JSON.stringify({
          revision: 1,
          draft: {
            ...draft("Unsent legacy comment"),
            promptText: "Old request",
          },
        }),
      );
      const host = {
        call: async (name: string, args: Record<string, unknown>) => {
          if (name === "arco_read_draft")
            return store.readDraft(args.key as DraftKey);
          if (name === "arco_write_draft")
            return store.writeDraft({
              key: args.key as DraftKey,
              expectedRevision: args.expectedRevision as number,
              draft: args.draft as Draft,
            });
          throw new Error(`Unexpected draft tool: ${name}`);
        },
      } as unknown as ArcoHost;
      const controller = draftController(host);
      const original = await readFile(file);
      await expect(controller.load(github)).resolves.toBeUndefined();
      expect(controller.get()[JSON.stringify(github)]).toMatchObject({
        state: "error",
        error:
          "Your saved draft could not be opened. It has been kept unchanged.",
      });
      controller.schedule(github, draft("New unsent input"));
      controller.flush();
      await vi.waitFor(() =>
        expect(controller.get()[JSON.stringify(github)]?.state).toBe("error"),
      );
      expect(controller.value(github)).toEqual(draft("New unsent input"));
      expect(await readFile(file)).toEqual(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("keeps one live value and write queue across provider view subscriptions", async () => {
    const { host, call } = fixture();
    const first = draftController(host);
    first.schedule(github, draft("Unsent GitHub comment"));
    const nextView = draftController(host);
    expect(nextView).toBe(first);
    expect(await nextView.load(github)).toEqual(draft("Unsent GitHub comment"));
    nextView.schedule(linear, draft("Separate Linear comment"));
    first.schedule(github, draft(""));
    expect(nextView.value(linear)?.comment).toBe("Separate Linear comment");
    expect(nextView.value(github)?.comment).toBe("");
    nextView.flush();
    await vi.waitFor(() =>
      expect(nextView.get()[JSON.stringify(github)]?.state).toBe("saved"),
    );
    expect(
      call.mock.calls.filter(([name]) => name === "arco_write_draft"),
    ).toHaveLength(2);
  });
  it("does not overwrite input with a delayed initial disk read", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const host = { call: vi.fn(() => pending) } as unknown as ArcoHost;
    const controller = draftController(host);
    const reading = controller.load(github);
    controller.schedule(github, draft("New input"));
    release({ revision: 0, draft: draft("Old disk input") });
    await expect(reading).resolves.toEqual(draft("New input"));
    expect(controller.value(github)).toEqual(draft("New input"));
    controller.flush();
  });
});

describe("draft protection messages", () => {
  const renderStatus = (status: Parameters<typeof DraftStatus>[0]["status"]) =>
    renderToStaticMarkup(
      createElement(DraftStatus, {
        status,
        onRetry: () => {},
        onResolve: () => {},
      }),
    );

  it.each(["idle", "loading", "pending", "saved", "resolving"] as const)(
    "keeps ordinary %s draft persistence quiet",
    (state) => expect(renderStatus({ state })).toBe(""),
  );
  it("retains a draft error and an explicit retry", () => {
    const html = renderStatus({
      state: "error",
      error: "The draft could not be stored.",
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("The draft could not be stored.");
    expect(html).toContain("Retry saving draft");
  });
  it.each([
    ["load", "Retry loading draft"],
    ["save", "Retry saving draft"],
    ["delete", "Retry removing draft"],
  ] as const)("names the failed %s operation", (operation, label) => {
    const html = renderStatus({
      state: "error",
      operation,
      error: "Unavailable",
    });
    expect(html).toContain(label);
  });
  it("retains conflicting saved content and both resolution choices", () => {
    const html = renderStatus({
      state: "conflict",
      error: "Another view changed this draft.",
      remote: { revision: 3, draft: draft("Other screen comment") },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Other screen comment");
    expect(html).toContain("Save this screen’s draft");
    expect(html).toContain("Use saved draft");
  });
});
