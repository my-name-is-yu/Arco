import { describe, expect, it } from "vitest";
import {
  annotationAttachment,
  contextAttachment,
} from "../src/ui/context-attachment";
import type { SelectionAnnotationContext } from "../src/shared/contracts";

const annotation: SelectionAnnotationContext = {
  number: 7,
  issue: {
    source: "github",
    repo: "yu/Arco",
    number: 42,
    id: "native-42",
    title: "A title that is not selected",
    url: "https://github.com/yu/Arco/issues/42",
    state: "open",
  },
  selection: {
    text: "  selected\npassage  ",
    origin: "comment",
    commentId: "native-comment",
    comment: "Please explain",
  },
};

describe("removable annotation payloads", () => {
  it("keeps all selected context in one visible block per stable annotation", () => {
    const snapshotId = "d849445f-dbf3-4988-847b-81d2966dc0a2";
    const payload = annotationAttachment([annotation], snapshotId);
    expect(payload.structuredContent).toEqual({
      source: "arco",
      arcoAnnotationFormat: 2,
      arcoAnnotationSnapshotId: snapshotId,
    });
    expect(payload.content).toEqual([
      {
        type: "text",
        text: "yu/Arco #42\nhttps://github.com/yu/Arco/issues/42\nOrigin: comment\nComment ID: native-comment\n\nSelected text:\n  selected\npassage  \n\nUser comment:\nPlease explain",
        _meta: {
          "openai/title": "selected passage",
          "openai/group": { title: "Annotations" },
          "arco/annotation": annotation,
        },
      },
    ]);
    expect(payload.content[0]!.text).not.toContain(annotation.issue!.title);
    expect(JSON.stringify(payload.structuredContent)).not.toContain("selected");
    expect(JSON.stringify(payload.structuredContent)).not.toContain(
      "Please explain",
    );
  });

  it("keeps stable IDs out of display text and shortens only preview titles", () => {
    const second = {
      number: 19,
      selection: { text: "x".repeat(80), origin: "ui" as const },
    };
    const payload = annotationAttachment([annotation, second]);
    expect(payload.content[1]!._meta["openai/title"]).toBe(
      `${"x".repeat(64)}…`,
    );
    expect(payload.content[1]!._meta["arco/annotation"].number).toBe(19);
    expect(payload.content[1]!.text).toBe(
      `Arco\nOrigin: ui\n\nSelected text:\n${second.selection.text}`,
    );
    expect(annotationAttachment([])).toEqual({
      content: [],
      structuredContent: { source: "arco", arcoAnnotationFormat: 2 },
    });
  });

  it("validates metadata and drops unselected issue fields", () => {
    const withBody = {
      ...annotation,
      issue: { ...annotation.issue!, body: "secret history" },
    };
    expect(
      annotationAttachment([withBody]).content[0]!._meta["arco/annotation"]
        .issue,
    ).not.toHaveProperty("body");
    expect(() => annotationAttachment([annotation, annotation])).toThrow(
      "unique positive numbers",
    );
    expect(() =>
      annotationAttachment([{ ...annotation, number: 0 }]),
    ).toThrow();
    expect(() => annotationAttachment([annotation], "../settings")).toThrow();
  });

  it("captures metadata independently of later caller edits", () => {
    const draft = { ...annotation, selection: { ...annotation.selection } };
    const payload = annotationAttachment([draft]);
    draft.selection.comment = "Later unsaved edit";
    expect(payload.content[0]!._meta["arco/annotation"].selection.comment).toBe(
      "Please explain",
    );
  });

  it("preserves whole-Issue attachment behavior", () => {
    const context = {
      source: "github",
      repo: "yu/Arco",
      number: 42,
      body: "Issue body",
    };
    const payload = contextAttachment(context, "yu/Arco #42", "Arco #42");
    expect(payload.structuredContent).toEqual({
      ...context,
      arcoSharedIssue: 1,
    });
    expect(payload.content).toHaveLength(2);
    expect(payload.content[1]).toMatchObject({
      annotations: { audience: ["assistant"] },
    });
  });
});
