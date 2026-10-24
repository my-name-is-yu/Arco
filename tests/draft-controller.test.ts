import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftController, DraftStatus } from "../src/ui/useDraftPersistence";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStateStore } from "../src/server/state";
import type { ArcoHost } from "../src/shared/contracts";
import type { Draft, DraftKey } from "../src/shared/state";

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
describe("host-lifetime draft controller", () => {
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
        error: expect.stringContaining("current format"),
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
