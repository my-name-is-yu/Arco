import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ArcoHost,
  SelectionAnnotationContext,
} from "../src/shared/contracts";
import { useSharedAnnotations } from "../src/ui/useSharedAnnotations";
import type { Annotation } from "../src/ui/selection-context";
import type { SelectionAnchor } from "../src/ui/selection-anchor";

const context: SelectionAnnotationContext = {
  number: 1,
  issue: {
    source: "github",
    repo: "owner/private",
    number: 42,
    id: "issue-42",
    title: "Private issue",
    url: "https://github.com/owner/private/issues/42",
    state: "open",
  },
  selection: { text: "Selected provider text", origin: "body" },
};

function controller(
  existing: SelectionAnnotationContext[] = [],
  write = vi.fn().mockResolvedValue({}),
) {
  let shared = existing;
  let snapshot: string | null = null;
  const shareAnnotations = vi
    .fn<ArcoHost["shareAnnotations"]>()
    .mockImplementation(async (next, id) => {
      shared = next;
      snapshot = id ?? null;
    });
  const host = {
    sharedAnnotations: () => shared,
    annotationSnapshotId: () => snapshot,
    shareAnnotations,
    call: write,
  } as unknown as ArcoHost;
  let result: ReturnType<typeof useSharedAnnotations> | undefined;
  function Probe() {
    result = useSharedAnnotations(host, () => {});
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (!result) throw new Error("The annotation hook was not rendered.");
  return {
    controller: result,
    host,
    shareAnnotations,
    write,
    updateContext: (
      next: SelectionAnnotationContext[],
      id: string | null = snapshot,
    ) => {
      shared = next;
      snapshot = id;
    },
  };
}

describe("annotation synchronization after a cancelled share", () => {
  it.each([100, 500])(
    "reconciles %i annotations with linear number reads",
    async (size) => {
      let reads = 0;
      const existing = Array.from({ length: size }, (_, index) => ({
        ...context,
        get number() {
          reads += 1;
          return index + 1;
        },
      }));
      const fixture = controller(existing);
      const updated = existing
        .map((item) => ({
          ...item,
          selection: { ...item.selection, comment: "Updated host comment" },
        }))
        .reverse();
      fixture.updateContext(updated);
      reads = 0;
      await expect(fixture.controller.share([], () => false)).resolves.toBe(
        false,
      );
      expect(reads).toBeLessThanOrEqual(size * 4);
      expect(
        fixture.controller.current.current.map((item) => item.context),
      ).toEqual(updated);
    },
  );

  it("retains the first matching target across comment edits and drops stale anchors", async () => {
    const matching = { ...context, number: 7 };
    const changed = { ...context, number: 9 };
    const firstTarget = { sourceText: context.selection.text };
    const laterTarget = { sourceText: context.selection.text };
    const fixture = controller();
    fixture.controller.commit([
      {
        context: {
          ...matching,
          selection: { text: "Other text", origin: "body" },
        },
        target: laterTarget,
      },
      { context: matching, target: firstTarget },
      { context: matching, target: laterTarget },
      { context: { ...context, number: 8 }, target: laterTarget },
      { context: changed, target: laterTarget },
    ]);
    const anchor: SelectionAnchor = {
      issueKey: "owner/private#42",
      rootKind: ".detail-pane",
      sourceText: context.selection.text,
      target: {
        kind: "range",
        start: { path: [], offset: 0 },
        end: { path: [], offset: 1 },
      },
    };
    for (const number of [7, 8, 9])
      fixture.controller.anchors.current.set(number, anchor);
    const updated = [
      {
        ...matching,
        selection: { ...matching.selection, comment: "Changed note only" },
      },
      {
        ...changed,
        selection: { ...changed.selection, commentId: "different-comment" },
      },
    ];
    fixture.updateContext(updated);
    await fixture.controller.share([], () => false);
    expect(fixture.controller.current.current[0].target).toBe(firstTarget);
    expect(fixture.controller.current.current[1].target).toBeNull();
    expect([...fixture.controller.anchors.current]).toEqual([[7, anchor]]);

    fixture.updateContext(updated, crypto.randomUUID());
    await fixture.controller.share([], () => false);
    expect(
      fixture.controller.current.current.every((item) => item.target === null),
    ).toBe(true);
    expect(fixture.controller.anchors.current.size).toBe(0);
  });
});

describe("new GitHub selection sharing authentication", () => {
  it("rechecks the candidate generation after the snapshot write and leaves existing attachments unchanged", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = vi.fn().mockReturnValue(pending);
    const initial = { ...context, number: 7 };
    const fixture = controller([initial], write);
    let scope = "account-a";
    const captured = scope;
    const next: Annotation[] = [
      { context: initial, target: null },
      { context, target: null },
    ];
    const shared = fixture.controller.share(next, () => scope === captured);
    await vi.waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "arco_write_annotation_snapshot",
        expect.any(Object),
      ),
    );
    scope = "account-b";
    release();
    await expect(shared).resolves.toBe(false);
    expect(fixture.shareAnnotations).not.toHaveBeenCalled();
    expect(fixture.host.sharedAnnotations()).toEqual([initial]);
  });

  it("shares normally in the captured generation without adding authentication metadata to the attachment", async () => {
    const fixture = controller();
    await expect(
      fixture.controller.share([{ context, target: null }], () => true),
    ).resolves.toBe(true);
    expect(fixture.shareAnnotations).toHaveBeenCalledWith(
      [context],
      expect.any(String),
    );
    expect(fixture.host.sharedAnnotations()).toEqual([context]);
  });

  it("keeps existing host-owned GitHub attachments editable and removable without a new-candidate guard", async () => {
    const fixture = controller([context]);
    const edited = {
      ...context,
      selection: {
        ...context.selection,
        comment: "Keep the existing host attachment.",
      },
    };
    await expect(
      fixture.controller.share([{ context: edited, target: null }]),
    ).resolves.toBe(true);
    expect(fixture.host.sharedAnnotations()).toEqual([edited]);
    await expect(fixture.controller.share([])).resolves.toBe(true);
    expect(fixture.host.sharedAnnotations()).toEqual([]);
    expect(fixture.shareAnnotations).toHaveBeenCalledTimes(2);
  });
});
