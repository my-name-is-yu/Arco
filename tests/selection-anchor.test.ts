import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  persistSelectionAnchor,
  type SelectionAnchor,
} from "../src/ui/selection-anchor";
import { persistedSelectionAnchorSchema } from "../src/shared/annotation-state";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const base = {
  issueKey: JSON.stringify(["github", "yu/Arco", 42, "issue-42"]),
  rootKind: ".detail-pane" as const,
};
afterEach(() => vi.unstubAllGlobals());

describe("persisting selection anchors", () => {
  it("stores input positions and hashes without the selected text or unselected draft", async () => {
    const selected = "Selected passage 🧭";
    const prefix = "Private unselected draft before ";
    const value = `${prefix}${selected} and private text after`;
    const runtime: SelectionAnchor = {
      ...base,
      sourceText: selected,
      target: {
        kind: "editable",
        path: [2, 1],
        signature: '["TEXTAREA",null,"Comment on GitHub",null,null]',
        start: prefix.length,
        end: prefix.length + selected.length,
        value,
      },
    };
    const saved = await persistSelectionAnchor(runtime, selected);
    expect(persistedSelectionAnchorSchema.safeParse(saved).success).toBe(true);
    expect(saved?.target).toMatchObject({
      kind: "editable",
      valueHash: digest(value),
      start: prefix.length,
      end: prefix.length + selected.length,
    });
    expect(saved?.selectionHash).toBe(digest(selected));
    const serialized = JSON.stringify(saved);
    expect(serialized).not.toContain(selected);
    expect(serialized).not.toContain("Private unselected");
    expect(serialized).not.toContain("private text after");
    expect(serialized).not.toContain('"value":');
    expect(serialized).not.toContain('"sourceText":');
    expect(runtime.target).toHaveProperty("value", value);
  });

  it("keeps the visible selection fingerprint separate from the full DOM range fingerprint", async () => {
    const selected = "  visible selection\n";
    const sourceText = `${selected}hidden details not shared with the model`;
    const runtime: SelectionAnchor = {
      ...base,
      sourceText,
      target: {
        kind: "range",
        start: { path: [1, 0], offset: 2 },
        end: { path: [4, 0], offset: 18 },
      },
    };
    const saved = await persistSelectionAnchor(runtime, selected);
    expect(saved?.selectionHash).toBe(digest(selected));
    expect(saved?.selectionHash).not.toBe(digest(selected.trim()));
    expect(saved?.target).toHaveProperty("sourceHash", digest(sourceText));
    expect(JSON.stringify(saved)).not.toContain("visible selection");
    expect(JSON.stringify(saved)).not.toContain("hidden details");
    expect(saved?.target).not.toHaveProperty("valueHash");
  });

  it("does not save positions outside the bounded persistent schema", async () => {
    const anchor: SelectionAnchor = {
      ...base,
      sourceText: "selected",
      target: {
        kind: "range",
        start: { path: new Array(65).fill(0), offset: 0 },
        end: { path: [1], offset: 8 },
      },
    };
    expect(await persistSelectionAnchor(anchor, "selected")).toBeNull();
  });

  it("leaves anchors transient when WebCrypto is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    const anchor: SelectionAnchor = {
      ...base,
      sourceText: "selected",
      target: {
        kind: "range",
        start: { path: [0], offset: 0 },
        end: { path: [0], offset: 8 },
      },
    };
    expect(await persistSelectionAnchor(anchor, "selected")).toBeNull();
  });
});
