import type { Draft } from "../shared/state";

type Content = { title: string; body: string; updatedAt: string };
export function resolveContentDraft(issue: Content, stored: Draft): Draft {
  const titleChanged =
    Boolean(stored.baseUpdatedAt) && stored.title !== stored.baseTitle;
  const bodyChanged =
    Boolean(stored.baseUpdatedAt) && stored.body !== stored.baseBody;
  if (
    (!titleChanged && !bodyChanged) ||
    (stored.title === issue.title && stored.body === issue.body)
  )
    return {
      ...stored,
      title: issue.title,
      body: issue.body,
      baseTitle: undefined,
      baseBody: undefined,
      baseUpdatedAt: undefined,
    };
  return {
    ...stored,
    title: titleChanged ? stored.title : issue.title,
    body: bodyChanged ? stored.body : issue.body,
    baseTitle: titleChanged ? stored.baseTitle : issue.title,
    baseBody: bodyChanged ? stored.baseBody : issue.body,
  };
}
export function contentConflict(issue: Content, draft: Draft): boolean {
  return (
    Boolean(draft.baseUpdatedAt) &&
    ((draft.title !== draft.baseTitle &&
      issue.title !== draft.baseTitle &&
      issue.title !== draft.title) ||
      (draft.body !== draft.baseBody &&
        issue.body !== draft.baseBody &&
        issue.body !== draft.body))
  );
}
