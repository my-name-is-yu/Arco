import { describe, expect, it } from "vitest";
import { draftConflict, resolveDraft } from "../src/ui/App";
import type { IssueDetail } from "../src/shared/contracts";

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

describe("Issue draft concurrency", () => {
  it("comment and prompt drafts do not freeze an old title or body", () => {
    const latest = source({ title: "Changed elsewhere", body: "New body" });
    const draft = resolveDraft(latest, {
      title: "Old title",
      body: "Old body",
      comment: "Keep comment",
      promptText: "Keep prompt",
    });
    expect(draft).toMatchObject({
      title: latest.title,
      body: latest.body,
      comment: "Keep comment",
      promptText: "Keep prompt",
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
      promptText: "Keep prompt",
    };
    const resolved = resolveDraft(latest, clean);
    expect(resolved.body).toBe("New remote body");
    expect(resolved.baseUpdatedAt).toBeUndefined();
    expect(resolved.comment).toBe("Comment draft");
    expect(resolved.promptText).toBe("Keep prompt");
  });
});
