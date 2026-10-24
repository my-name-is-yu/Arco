import { describe, expect, it } from "vitest";
import {
  contentConflict as draftConflict,
  resolveContentDraft as resolveDraft,
} from "../src/ui/content-drafts";
import { mergeCommentPages } from "../src/ui/github-comments";
import type { Comment, IssueDetail } from "../src/shared/contracts";

const source = (patch: Partial<IssueDetail> = {}): IssueDetail => ({
  repo: "yu/Arco",
  number: 42,
  source: "github",
  id: "issue-42",
  title: "Original title",
  body: "Original body",
  state: "open",
  updatedAt: "2026-10-22T00:00:00Z",
  url: "https://github.com/yu/Arco/issues/42",
  author: "yu",
  labels: [],
  assignees: [],
  comments: [],
  commentsHasMore: false,
  projects: [],
  stateReason: null,
  ...patch,
});

const edited = () => ({
  title: "Original title",
  body: "My unsaved edit",
  comment: "Comment draft",
  baseTitle: "Original title",
  baseBody: "Original body",
  baseUpdatedAt: source().updatedAt,
});

describe("GitHub comment page revisions", () => {
  const comment = (id: string, body: string, updatedAt: string): Comment => ({
    id,
    body,
    updatedAt,
    author: "yu",
    url: `https://github.com/yu/Arco/issues/42#${id}`,
  });
  it("keeps a newly posted comment visible across a gap and deduplicates its native page", () => {
    const first = comment("first", "First comment", "2026-10-22T00:00:00Z");
    const posted = comment(
      "posted",
      "Posted beyond the loaded pages",
      "2026-10-24T00:00:00Z",
    );
    expect(
      mergeCommentPages(
        [{ comments: [first], hasMore: true, nextPage: 2 }],
        [posted],
      ),
    ).toEqual([first, posted]);
    expect(
      mergeCommentPages(
        [
          { comments: [first], hasMore: true, nextPage: 2 },
          { comments: [posted], hasMore: false },
        ],
        [posted],
      ),
    ).toEqual([first, posted]);
  });
  it("lets a newer provider revision replace an acknowledged post without changing its position", () => {
    const posted = comment(
      "posted",
      "Earlier acknowledged text",
      "2026-10-24T00:00:00Z",
    );
    const native = comment(
      "posted",
      "Edited externally",
      "2026-10-24T00:01:00Z",
    );
    expect(
      mergeCommentPages([{ comments: [native], hasMore: false }], [posted]),
    ).toEqual([native]);
  });
  it("keeps an acknowledged edit when GitHub returns an older body from the same second", () => {
    const native = comment("posted", "Earlier text", "2026-10-24T00:00:00Z");
    const acknowledged = { ...native, body: "Saved text in the same second" };
    expect(
      mergeCommentPages(
        [{ comments: [native], hasMore: false }],
        [acknowledged],
      ),
    ).toEqual([acknowledged]);
  });
});

describe("Issue draft concurrency", () => {
  it("comment drafts do not freeze an old title or body", () => {
    const latest = source({ title: "Changed elsewhere", body: "New body" });
    const draft = resolveDraft(latest, {
      title: "Old title",
      body: "Old body",
      comment: "Keep comment",
    });
    expect(draft).toMatchObject({
      title: latest.title,
      body: latest.body,
      comment: "Keep comment",
    });
    expect(draftConflict(latest, draft)).toBe(false);
  });

  it("retains unsaved edits across own metadata or comment updates without a content conflict", () => {
    const latest = source({
      updatedAt: "2026-10-22T01:00:00Z",
      state: "closed",
      assignees: ["yu"],
    });
    const draft = resolveDraft(latest, edited());
    expect(draft.body).toBe("My unsaved edit");
    expect(draft.comment).toBe("Comment draft");
    expect(draftConflict(latest, draft)).toBe(false);
  });

  it("preserves an external title update while a different body edit is pending", () => {
    const latest = source({
      title: "New remote title",
      updatedAt: "2026-10-22T01:00:00Z",
    });
    const draft = resolveDraft(latest, edited());
    expect(draft.title).toBe("New remote title");
    expect(draft.body).toBe("My unsaved edit");
    expect(draftConflict(latest, draft)).toBe(false);
  });

  it("detects external content edits and preserves the draft until the user rebases", () => {
    const latest = source({
      body: "Their new body",
      updatedAt: "2026-10-22T01:00:00Z",
    });
    const draft = resolveDraft(latest, edited());
    expect(draftConflict(latest, draft)).toBe(true);
    expect(draft.body).toBe("My unsaved edit");
    const rebased = {
      ...draft,
      baseTitle: latest.title,
      baseBody: latest.body,
      baseUpdatedAt: latest.updatedAt,
    };
    expect(draftConflict(latest, rebased)).toBe(false);
    expect(rebased.body).toBe("My unsaved edit");
    expect(rebased.comment).toBe("Comment draft");
  });

  it("shows newly fetched content after a saved or discarded edit while retaining unrelated drafts", () => {
    const latest = source({ body: "New remote body" });
    const clean = {
      ...edited(),
      body: "Original body",
    };
    const resolved = resolveDraft(latest, clean);
    expect(resolved.body).toBe("New remote body");
    expect(resolved.baseUpdatedAt).toBeUndefined();
    expect(resolved.comment).toBe("Comment draft");
  });
});
