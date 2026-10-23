import { describe, expect, it } from "vitest";
import {
  displayedLinearComments,
  reconcileLinearCommentChanges,
} from "../src/ui/linear-comments";
import type { LinearComment, LinearCommentPage } from "../src/shared/linear";

const comment = (
  id: string,
  body = id,
  updatedAt = "2026-10-24T01:00:00.000Z",
): LinearComment => ({
  id,
  body,
  updatedAt,
  author: "Reviewer",
  authorId: "user",
  parentId: null,
  url: `https://linear.app/test/issue/TST-1#${id}`,
  reactions: [],
});
const page = (...comments: LinearComment[]): LinearCommentPage => ({
  comments,
  hasMore: false,
  cursor: null,
});

describe("loaded Linear discussion pages", () => {
  it("deduplicates overlapping pages while retaining insertion order and acknowledged comments outside the loaded range", () => {
    const first = comment("first");
    const second = comment("second");
    const posted = { ...comment("posted"), parentId: "unloaded-parent" };
    expect(
      displayedLinearComments(
        [page(first, second), page(second, comment("third"))],
        { posted },
      ),
    ).toEqual([first, second, comment("third"), posted]);
  });
  it("keeps a newer provider edit and applies deletion tombstones without removing the newer comment", () => {
    const newer = comment(
      "edited",
      "Edited elsewhere",
      "2026-10-24T02:00:00.000Z",
    );
    expect(
      displayedLinearComments([page(newer, comment("deleted"))], {
        edited: comment("edited"),
        deleted: null,
      }),
    ).toEqual([newer]);
  });
  it("drops confirmed acknowledgements so a subsequent provider deletion cannot resurrect them", () => {
    const posted = comment("posted");
    const missing = comment("not-yet-loaded");
    const changes = reconcileLinearCommentChanges([page(posted)], {
      posted,
      "not-yet-loaded": missing,
      deleted: null,
    });
    expect(changes).toEqual({ "not-yet-loaded": missing, deleted: null });
    expect(displayedLinearComments([page()], changes)).toEqual([missing]);
    const newer = comment(
      "not-yet-loaded",
      "Changed elsewhere",
      "2026-10-24T02:00:00.000Z",
    );
    expect(reconcileLinearCommentChanges([page(newer)], changes)).toEqual({
      deleted: null,
    });
  });
});
