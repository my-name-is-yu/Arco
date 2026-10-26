import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ArcoHost,
  SelectionAnnotationContext,
} from "../src/shared/contracts";
import { useSharedAnnotations } from "../src/ui/useSharedAnnotations";
import type { Annotation } from "../src/ui/selection-context";

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
  return { controller: result, host, shareAnnotations, write };
}

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
