import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  annotationSnapshotSchema,
  type AnnotationSnapshot,
} from "../src/shared/annotation-state";
import { createStateStore, StateConflict } from "../src/server/state";

const directories: string[] = [];
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), "arco-annotations-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
function snapshot(): AnnotationSnapshot {
  return {
    id: randomUUID(),
    anchors: [
      {
        number: 1,
        contextHash: "a".repeat(64),
        anchor: {
          rootKind: ".detail-pane",
          issueKey: '["github","yu/Arco",42,"native-42"]',
          selectionHash: "b".repeat(64),
          target: {
            kind: "editable",
            path: [1],
            signature: '["TEXTAREA","Comment"]',
            start: 2,
            end: 4,
            valueHash: "c".repeat(64),
          },
        },
      },
    ],
  };
}

describe("annotation position storage", () => {
  it("keeps independent attachment snapshots across stores and refuses to overwrite an existing ID", async () => {
    const directory = await temporary();
    const first = createStateStore(directory);
    const second = createStateStore(directory);
    const a = snapshot();
    const b = snapshot();
    await Promise.all([
      first.writeAnnotationSnapshot(a),
      second.writeAnnotationSnapshot(b),
    ]);
    expect((await second.readAnnotationSnapshot(a.id)).snapshot).toEqual(a);
    expect((await first.readAnnotationSnapshot(b.id)).snapshot).toEqual(b);
    await first.writeAnnotationSnapshot(a);
    await expect(
      second.writeAnnotationSnapshot({ ...a, anchors: [] }),
    ).rejects.toBeInstanceOf(StateConflict);
    await first.deleteAnnotationSnapshot(a.id);
    expect((await second.readAnnotationSnapshot(a.id)).snapshot).toBeNull();
    expect((await first.readAnnotationSnapshot(b.id)).snapshot).toEqual(b);
    expect(
      (await first.readAnnotationSnapshot(randomUUID())).snapshot,
    ).toBeNull();
  });
  it("rejects input text, arbitrary IDs, duplicate numbers, and workspace anchors without a fingerprint", async () => {
    const value = snapshot();
    const anchor = value.anchors[0].anchor;
    expect(
      annotationSnapshotSchema.safeParse({ ...value, id: "../drafts" }).success,
    ).toBe(false);
    expect(
      annotationSnapshotSchema.safeParse({
        ...value,
        anchors: [...value.anchors, ...value.anchors],
      }).success,
    ).toBe(false);
    expect(
      annotationSnapshotSchema.safeParse({
        ...value,
        anchors: [
          {
            ...value.anchors[0],
            anchor: {
              ...anchor,
              target: { ...anchor.target, value: "unselected private draft" },
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      annotationSnapshotSchema.safeParse({
        ...value,
        anchors: [
          { ...value.anchors[0], anchor: { ...anchor, rootKind: ".arco" } },
        ],
      }).success,
    ).toBe(false);
    const store = createStateStore(await temporary());
    await expect(
      store.readAnnotationSnapshot("../settings.json"),
    ).rejects.toThrow();
  });
  it("bounds retained positions without removing recent snapshots", async () => {
    const store = createStateStore(await temporary());
    const first = snapshot();
    await store.writeAnnotationSnapshot(first);
    let latest = first;
    for (let index = 0; index < 100; index++) {
      latest = snapshot();
      await store.writeAnnotationSnapshot(latest);
    }
    expect((await store.readAnnotationSnapshot(first.id)).snapshot).toBeNull();
    expect((await store.readAnnotationSnapshot(latest.id)).snapshot).toEqual(
      latest,
    );
  });
});
