import { describe, expect, it } from "vitest";
import { readSharedContext } from "../src/ui/shared-context";

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
