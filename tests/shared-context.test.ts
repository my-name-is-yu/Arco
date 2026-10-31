import { describe, expect, it } from "vitest";
import { readModelContext, readSharedContext } from "../src/ui/shared-context";
import { annotationAttachment } from "../src/ui/context-attachment";
import type { SelectionAnnotationContext } from "../src/shared/contracts";

const sharedRefFromContext = (value: unknown) => readSharedContext(value).issue;
const sharedAnnotationsFromContext = (value: unknown) =>
  readSharedContext(value).annotations;

describe("restoring shared app context", () => {
  it("restores only native refs from marked structured context", () => {
    expect(
      sharedRefFromContext({
        arcoSharedIssue: 1,
        source: "github",
        repo: "yu/Arco",
        number: 43,
        body: "not retained",
      }),
    ).toEqual({ source: "github", repo: "yu/Arco", number: 43 });
    expect(
      sharedRefFromContext({
        arcoSharedIssue: 1,
        source: "linear",
        connectionId: "default",
        workspaceId: "workspace",
        teamId: "team",
        id: "native-issue",
        body: "not retained",
      }),
    ).toEqual({
      source: "linear",
      connectionId: "default",
      workspaceId: "workspace",
      teamId: "team",
      issueId: "native-issue",
    });
  });
  it("does not navigate from text, unmarked app data, malformed refs or unknown versions", () => {
    for (const value of [
      "yu/Arco #43",
      null,
      { source: "github", repo: "yu/Arco", number: 43 },
      { arcoSharedIssue: 1, source: "github", repo: "../Arco", number: 43 },
      { arcoSharedIssue: 1, source: "github", repo: "yu/Arco", number: -1 },
      { arcoSharedIssue: 2, source: "github", repo: "yu/Arco", number: 43 },
      {
        arcoSharedIssue: 1,
        source: "linear",
        id: "native-issue",
        connectionId: "default",
        workspaceId: "workspace",
      },
    ])
      expect(sharedRefFromContext(value)).toBeNull();
  });
  it("rejects selection-only attachments for both navigation and annotations", () => {
    const selection = {
      text: "Old selected fragment",
      origin: "comment",
      commentId: "old-comment",
    };
    for (const value of [
      {
        source: "github",
        repo: "yu/Arco",
        number: 42,
        arcoSharedIssue: 1,
        selection,
      },
      {
        source: "linear",
        connectionId: "default",
        workspaceId: "workspace",
        teamId: "team",
        id: "issue",
        arcoSharedIssue: 1,
        selection,
      },
      { source: "arco", selection },
    ]) {
      expect(sharedRefFromContext(value)).toBeNull();
      expect(sharedAnnotationsFromContext(value)).toBeNull();
    }
  });

  it("reads one current annotation without mistaking a malformed collection for whole-Issue context", () => {
    const annotation = {
      number: 1,
      issue: {
        source: "github",
        repo: "yu/Arco",
        number: 42,
        id: "native-42",
        title: "Issue",
        url: "https://github.com/yu/Arco/issues/42",
        state: "open",
      },
      selection: {
        text: "  selected text\n",
        origin: "body",
        comment: "My comment",
      },
    };
    const value = {
      ...annotation.issue,
      arcoSharedIssue: 1,
      selection: annotation.selection,
      annotations: [annotation],
      arcoAnnotationSnapshotId: "d849445f-dbf3-4988-847b-81d2966dc0a2",
    };
    expect(readSharedContext(value)).toEqual({
      issue: { source: "github", repo: "yu/Arco", number: 42 },
      annotations: [annotation],
      snapshotId: value.arcoAnnotationSnapshotId,
    });
    expect(
      readSharedContext({ ...value, annotations: [annotation, annotation] }),
    ).toEqual({ issue: null, annotations: null, snapshotId: null });
    expect(
      sharedAnnotationsFromContext({ source: "arco", annotations: [] }),
    ).toEqual([]);
  });
});

const snapshotId = "d849445f-dbf3-4988-847b-81d2966dc0a2";
const annotationFor = (
  number: number,
  text = `Selected passage ${number}`,
): SelectionAnnotationContext => ({
  number,
  issue: {
    source: "github",
    repo: "yu/Arco",
    number: 42,
    id: "native-42",
    title: "Issue title",
    url: "https://github.com/yu/Arco/issues/42",
    state: "open",
  },
  selection: { text, origin: "body", comment: `Note ${number}` },
});

describe("restoring removable model context", () => {
  it("uses the remaining blocks rather than stale structured data after individual removal", () => {
    const first = annotationFor(2);
    const second = annotationFor(7);
    const payload = annotationAttachment([first, second], snapshotId);
    expect(readModelContext(payload)).toEqual({
      issue: null,
      annotations: [first, second],
      snapshotId,
      legacy: false,
    });
    expect(
      readModelContext({ ...payload, content: payload.content.slice(1) }),
    ).toEqual({
      issue: { source: "github", repo: "yu/Arco", number: 42 },
      annotations: [second],
      snapshotId,
      legacy: false,
    });
    expect(readModelContext({ ...payload, content: [] })).toEqual({
      issue: null,
      annotations: [],
      snapshotId: null,
      legacy: false,
    });
  });

  it("does not restore annotations from snapshots, missing blocks, hidden blocks or invalid metadata", () => {
    const payload = annotationAttachment([annotationFor(1)], snapshotId);
    for (const content of [
      undefined,
      "not blocks",
      [{ ...payload.content[0], annotations: { audience: ["assistant"] } }],
      [{ ...payload.content[0], _meta: { "arco/annotation": { number: 1 } } }],
    ]) {
      expect(readModelContext({ ...payload, content })).toEqual({
        issue: null,
        annotations: [],
        snapshotId: null,
        legacy: false,
      });
    }
    for (const value of [null, undefined])
      expect(readModelContext(value)).toEqual({
        issue: null,
        annotations: null,
        snapshotId: null,
        legacy: false,
      });
    expect(
      readModelContext({
        ...payload,
        structuredContent: {
          ...payload.structuredContent,
          arcoAnnotationFormat: 3,
        },
      }).annotations,
    ).toBeNull();
    expect(
      readModelContext({
        ...payload,
        content: [...payload.content, ...payload.content],
      }).annotations,
    ).toBeNull();
  });

  it("ignores hidden and malformed duplicate numbers while accepting blocks visible to both audiences", () => {
    const item = annotationFor(1);
    const payload = annotationAttachment([item]);
    const block = payload.content[0]!;
    expect(
      readModelContext({
        ...payload,
        content: [
          { ...block, annotations: { audience: ["assistant"] } },
          { ...block, _meta: { "arco/annotation": { number: item.number } } },
          { ...block, annotations: { audience: ["assistant", "user"] } },
        ],
      }).annotations,
    ).toEqual([item]);
  });

  it("restores Linear and generic selections without guessing a shared issue", () => {
    const linear: SelectionAnnotationContext = {
      number: 9,
      issue: {
        source: "linear",
        connectionId: "default",
        workspaceId: "workspace",
        teamId: "team",
        id: "native-linear",
        identifier: "ARC-1",
        title: "Linear title",
        url: "https://linear.app/team/issue/ARC-1",
        state: { id: "state", name: "Todo", type: "unstarted", color: "gray" },
      },
      selection: {
        text: "Linear passage",
        origin: "comment",
        commentId: "comment",
      },
    };
    expect(readModelContext(annotationAttachment([linear])).issue).toEqual({
      source: "linear",
      connectionId: "default",
      workspaceId: "workspace",
      teamId: "team",
      issueId: "native-linear",
    });
    expect(
      readModelContext(
        annotationAttachment([
          { number: 3, selection: { text: "UI", origin: "ui" } },
        ]),
      ).issue,
    ).toBeNull();
  });

  it("intersects legacy metadata with exact visible blocks before migration", () => {
    const first = annotationFor(1);
    const second = annotationFor(3);
    const structuredContent = {
      source: "arco",
      annotations: [first, second],
      arcoAnnotationSnapshotId: snapshotId,
    };
    const visible = {
      type: "text",
      text: `3. yu/Arco #42\n${second.selection.text}\n\nComment: ${second.selection.comment}`,
      _meta: { "openai/title": `#3 ${second.selection.text}` },
    };
    const hidden = {
      type: "text",
      text: `Issue context (source data):\n${JSON.stringify(structuredContent)}`,
      annotations: { audience: ["assistant"] },
    };
    expect(
      readModelContext({ content: [visible, hidden], structuredContent }),
    ).toEqual({
      issue: { source: "github", repo: "yu/Arco", number: 42 },
      annotations: [second],
      snapshotId,
      legacy: true,
    });
    for (const content of [
      [],
      [hidden],
      [{ ...visible, text: `${visible.text} changed` }],
      [{ ...visible, annotations: { audience: ["assistant"] } }],
      [{ ...visible, _meta: { "openai/title": "#1 different selection" } }],
    ])
      expect(readModelContext({ content, structuredContent })).toEqual({
        issue: null,
        annotations: [],
        snapshotId: null,
        legacy: true,
      });
    expect(readModelContext({ structuredContent })).toEqual({
      issue: null,
      annotations: null,
      snapshotId: null,
      legacy: false,
    });
  });

  it("matches legacy text and title on the same visible block without overwriting another match", () => {
    const first = annotationFor(1);
    const second = annotationFor(2);
    const structuredContent = {
      source: "arco",
      annotations: [first, second],
    };
    const blocks = [first, second].map((item) => ({
      type: "text",
      text: `${item.number}. yu/Arco #42\n${item.selection.text}\n\nComment: ${item.selection.comment}`,
      _meta: { "openai/title": `#${item.number} ${item.selection.text}` },
    }));
    const firstBlock = blocks[0]!;
    const secondBlock = blocks[1]!;
    const mismatched = [
      { ...firstBlock, _meta: secondBlock._meta },
      { ...secondBlock, _meta: firstBlock._meta },
    ];
    expect(
      readModelContext({
        structuredContent,
        content: [
          ...mismatched,
          ...blocks.map((block) => ({
            ...block,
            annotations: { audience: ["user"] },
          })),
        ],
      }).annotations,
    ).toEqual([]);
    expect(
      readModelContext({
        structuredContent,
        content: [
          { ...secondBlock, annotations: { audience: [] } },
          firstBlock,
          ...mismatched,
        ],
      }).annotations,
    ).toEqual([first, second]);
  });

  it("keeps marked whole-Issue context compatible", () => {
    const structuredContent = {
      source: "github",
      repo: "yu/Arco",
      number: 42,
      arcoSharedIssue: 1,
    };
    expect(readModelContext({ structuredContent })).toEqual({
      issue: { source: "github", repo: "yu/Arco", number: 42 },
      annotations: null,
      snapshotId: null,
      legacy: false,
    });
  });

  it("does not let restored UI edits mutate the host metadata snapshot", () => {
    const payload = annotationAttachment([annotationFor(1)]);
    const restored = readModelContext(payload);
    restored.annotations![0]!.selection.comment = "Unsaved UI edit";
    expect(payload.content[0]!._meta["arco/annotation"].selection.comment).toBe(
      "Note 1",
    );
  });
});
