import { useState, type ReactNode } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  Edit,
  Expand,
  ExternalLink,
} from "@openai/apps-sdk-ui/components/Icon";
import type {
  ArcoHost,
  IssueDetail,
  IssueRef,
  RepoMetadata,
} from "../shared/contracts";
import type { Draft } from "../shared/state";
import { contentConflict as draftConflict } from "./content-drafts";
import { DetailToolbar, closeDetailUtility } from "./DetailToolbar";
import { MarkdownEditor } from "./MarkdownEditor";
import { ConflictPanel } from "./ConflictPanel";
import { IssueMarkdown } from "./MarkdownContent";
import { toggleMarkdownTask } from "./markdown-tasks";
import { CommentActions, ReactionBar } from "./GitHubDiscussion";
import { CopyValue } from "./CopyValue";
import { MultiSelect } from "./MultiSelect";
import { SingleSelect } from "./SingleSelect";
import {
  IssueAssigneeVisual,
  IssueLabelVisual,
  IssueStateVisual,
} from "./IssuePropertyVisual";
import { LabelManager } from "./LabelManager";
import { GitHubProperties } from "./GitHubProperties";
import { GitHubRelations } from "./GitHubRelations";
import { DisclosureSummary } from "./DisclosureSummary";
import { useGitHubComments } from "./github-comments";
import { StateIcon, ShortDate } from "./GitHubIssueMeta";
import { githubStatePresentation } from "./github-state";
const refKey = (issue: IssueRef) => `${issue.repo}#${issue.number}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
type ContentProps = {
  feedback: ReactNode;
  onBack: () => void;
  onFullscreen: () => void;
  issue: IssueDetail;
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  metadata?: RepoMetadata;
  metadataError: Error | null;
  busy: boolean;
  save: (
    name: string,
    args: Record<string, unknown>,
    after?: (result: IssueDetail) => void,
  ) => Promise<void>;
  host: ArcoHost;
  hostBusy: boolean;
  hostAction: (action: () => Promise<void>) => Promise<void>;
  shared: IssueRef | null;
};

export function GitHubDetail({
  feedback,
  onBack,
  onFullscreen,
  issue,
  draft,
  onDraft,
  metadata,
  metadataError,
  busy,
  save,
  host,
  hostBusy,
  hostAction,
  shared,
}: ContentProps) {
  const comments = useGitHubComments(host, issue);
  const visibleComments = comments.comments;
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const state = githubStatePresentation(issue);
  const assigneeOptions = [
    ...new Set([...issue.assignees, ...(metadata?.assignees ?? [])]),
  ].map((name) => ({
    value: name,
    label: name,
    leading: <IssueAssigneeVisual name={name} />,
  }));
  const labelOptions = [
    ...new Map(
      [...issue.labels, ...(metadata?.labels ?? [])].map((label) => [
        label.id,
        label,
      ]),
    ).values(),
  ];
  const openMarkdownLink = (url: string) =>
    void hostAction(() => host.openLink(url));
  const ref = { repo: issue.repo, number: issue.number };
  const dirty = draft.title !== issue.title || draft.body !== issue.body;
  const contentConflict = draftConflict(issue, draft);
  const share = () => hostAction(() => host.share(issue));
  const differentSharedTarget = shared && refKey(shared) !== refKey(issue);
  const sharedTarget = shared ? `${shared.repo} #${shared.number}` : "";
  const sharedDescription = `Shared issue: ${sharedTarget}${differentSharedTarget ? " · Different from the issue you are browsing" : ""}`;

  return (
    <>
      <DetailToolbar
        target={`${issue.repo} #${issue.number}`}
        backLabel="Back to list"
        onBack={onBack}
        shared={
          shared ? (
            <span
              className="shared-chip"
              role="note"
              title={sharedDescription}
              aria-label={sharedDescription}
            >
              {differentSharedTarget ? `Chat: ${sharedTarget}` : "In chat"}
            </span>
          ) : undefined
        }
        primary={
          <Button
            color="primary"
            size="sm"
            disabled={hostBusy}
            onClick={() => void share()}
          >
            Add to chat
          </Button>
        }
        utilities={
          <>
            <button
              className="utility-item"
              aria-label="Edit issue"
              onClick={() => setEditing((value) => !value)}
            >
              <Edit aria-hidden="true" /> Edit issue
            </button>
            <div className="utility-item">
              <CopyValue value={issue.url} onCopied={closeDetailUtility} />
            </div>
            <div className="utility-item">
              <CopyValue
                value={`${issue.repo}#${issue.number}`}
                label="Copy ID"
                onCopied={closeDetailUtility}
              />
            </div>
            <button
              className="utility-item"
              aria-label="Open on GitHub"
              onClick={() => void hostAction(() => host.openLink(issue.url))}
            >
              <ExternalLink aria-hidden="true" /> Open on GitHub
            </button>
            <button
              className="utility-item"
              aria-label="Open fullscreen"
              onClick={onFullscreen}
            >
              <Expand aria-hidden="true" /> Open fullscreen
            </button>
          </>
        }
      />
      {feedback}
      <div className="detail-scroll motion-content">
        <div className="issue-heading">
          <div className="issue-kicker">
            <span className={`state-pill ${issue.state}`}>
              <StateIcon state={issue.state} />
              {issue.state === "open" ? "Open" : "Closed"}
            </span>
            <span>
              {issue.repo} <strong>#{issue.number}</strong>
            </span>
            {state.reason && <span className="muted">{state.reason}</span>}
          </div>
          <div className="title-line">
            <h1>{issue.title}</h1>
          </div>
          <div className="author-line">
            <span className="avatar">
              {issue.author.slice(0, 1).toUpperCase()}
            </span>
            <strong>{issue.author}</strong>
            <span>
              Updated <ShortDate date={issue.updatedAt} />
            </span>
            {dirty && <span className="draft-mark">Unsaved changes</span>}
          </div>
        </div>
        <div className="issue-columns">
          <article className="issue-main">
            {editing ? (
              <MarkdownEditor
                label="Edit issue body"
                title={draft.title}
                body={draft.body}
                titleLabel="Issue title"
                bodyLabel="Issue body"
                busy={busy}
                preview={preview}
                onPreview={setPreview}
                onTitle={(title) => onDraft({ title })}
                onBody={(body) => onDraft({ body })}
                renderedBody={
                  <IssueMarkdown
                    body={draft.body}
                    onOpen={openMarkdownLink}
                    image={{ host, issue }}
                  />
                }
              >
                {contentConflict && (
                  <ConflictPanel
                    source="GitHub"
                    latestTitle={issue.title}
                    latestBody={
                      <IssueMarkdown
                        body={issue.body}
                        image={{ host, issue }}
                        onOpen={openMarkdownLink}
                      />
                    }
                    busy={busy}
                    onKeep={() =>
                      onDraft({
                        baseUpdatedAt: issue.updatedAt,
                        baseTitle: issue.title,
                        baseBody: issue.body,
                      })
                    }
                    onUseLatest={() =>
                      onDraft({
                        title: issue.title,
                        body: issue.body,
                        baseUpdatedAt: undefined,
                        baseTitle: undefined,
                        baseBody: undefined,
                      })
                    }
                  />
                )}
                <div className="editor-actions">
                  <span className="muted">
                    Drafts stay available when you switch issues.
                  </span>
                  <Button
                    color="secondary"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(false)}
                  >
                    Close
                  </Button>
                  <Button
                    color="primary"
                    size="sm"
                    disabled={
                      busy || !draft.title.trim() || !dirty || contentConflict
                    }
                    loading={busy}
                    onClick={() =>
                      void save(
                        "arco_update_issue",
                        {
                          ...ref,
                          expectedUpdatedAt: issue.updatedAt,
                          patch: {
                            ...(draft.title !== issue.title
                              ? { title: draft.title }
                              : {}),
                            ...(draft.body !== issue.body
                              ? { body: draft.body }
                              : {}),
                          },
                        },
                        (result) => {
                          onDraft({
                            title: result.title,
                            body: result.body,
                            baseUpdatedAt: result.updatedAt,
                            baseTitle: result.title,
                            baseBody: result.body,
                          });
                          setEditing(false);
                        },
                      )
                    }
                  >
                    Save
                  </Button>
                </div>
              </MarkdownEditor>
            ) : (
              <section className="issue-body" data-context-origin="body">
                <IssueMarkdown
                  body={issue.body}
                  image={{ host, issue }}
                  onOpen={openMarkdownLink}
                  busy={busy || dirty}
                  onToggleTask={(line, checked) => {
                    const body = toggleMarkdownTask(issue.body, line, checked);
                    if (body !== issue.body)
                      void save("arco_update_issue", {
                        ...ref,
                        expectedUpdatedAt: issue.updatedAt,
                        patch: { body },
                      });
                  }}
                />
              </section>
            )}
            <ReactionBar host={host} issue={issue} />
            <section
              className="comments-section"
              aria-labelledby={`comments-${issue.number}`}
            >
              <h2 id={`comments-${issue.number}`}>
                Comments{" "}
                <span>
                  {visibleComments.length}
                  {comments.hasNextPage ? "+" : ""}
                </span>
              </h2>
              {visibleComments.map((comment) => (
                <article className="comment" key={comment.id}>
                  <div className="comment-heading">
                    <span className="avatar">
                      {comment.author.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{comment.author}</strong>
                    <ShortDate date={comment.updatedAt} />
                    <button
                      className="icon-button"
                      aria-label={`Open ${comment.author}’s comment on GitHub`}
                      onClick={() =>
                        void hostAction(() => host.openLink(comment.url))
                      }
                    >
                      ↗
                    </button>
                  </div>
                  <div
                    data-context-origin="comment"
                    data-comment-id={comment.id}
                  >
                    <IssueMarkdown
                      body={comment.body}
                      image={{ host, issue, commentId: comment.databaseId }}
                      onOpen={openMarkdownLink}
                    />
                  </div>
                  <CommentActions host={host} issue={issue} comment={comment} />
                </article>
              ))}
              {!visibleComments.length && (
                <p className="muted no-comments">No comments yet.</p>
              )}
              {comments.hasNextPage && (
                <button
                  className="text-button"
                  disabled={comments.isFetching}
                  onClick={() => void comments.fetchNextPage()}
                >
                  {comments.isFetchingNextPage
                    ? "Loading comments…"
                    : "Load more comments"}
                </button>
              )}
              {comments.isError && (
                <p className="inline-error" role="alert">
                  Could not load comments. {errorText(comments.error)}
                </p>
              )}
              <form
                className="comment-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(
                    "arco_comment",
                    { ...ref, body: draft.comment },
                    () => onDraft({ comment: "" }),
                  );
                }}
              >
                <textarea
                  id={`comment-${issue.number}`}
                  aria-label="Comment on GitHub"
                  disabled={busy}
                  value={draft.comment}
                  rows={3}
                  placeholder="Write a comment in Markdown…"
                  onChange={(event) => onDraft({ comment: event.target.value })}
                />
                <div className="comment-form-footer">
                  <Button
                    type="submit"
                    color="secondary"
                    variant="outline"
                    size="sm"
                    disabled={busy || !draft.comment.trim()}
                    loading={busy}
                  >
                    Comment
                  </Button>
                </div>
              </form>
            </section>
          </article>
          <aside className="issue-properties" aria-label="Issue attributes">
            <section className="state-property">
              <h2>Issue state</h2>
              <SingleSelect
                label="Change issue state"
                value={state.value}
                disabled={busy}
                onChange={(value) => {
                  void save("arco_update_issue", {
                    ...ref,
                    expectedUpdatedAt: issue.updatedAt,
                    patch:
                      value === "open"
                        ? { state: "open", stateReason: "reopened" }
                        : { state: "closed", stateReason: value },
                  });
                }}
                options={state.options.map((option) => ({
                  ...option,
                  leading: (
                    <IssueStateVisual source="github" state={option.value} />
                  ),
                }))}
              />
            </section>
            <section>
              <h2>
                Projects <span className="muted">Status</span>
              </h2>
              {issue.projects.map((project) => (
                <label
                  className="project-property"
                  key={`${project.projectId}:${project.fieldId}`}
                >
                  <span>{project.projectTitle}</span>
                  <SingleSelect
                    label={`${project.projectTitle} status`}
                    value={project.optionId ?? ""}
                    disabled={busy}
                    onChange={(value) => {
                      if (value)
                        void save("arco_project_status", {
                          ...ref,
                          projectId: project.projectId,
                          itemId: project.itemId,
                          fieldId: project.fieldId,
                          optionId: value,
                        });
                    }}
                    options={[
                      { value: "", label: "No status", disabled: true },
                      ...project.options.map((option) => ({
                        value: option.id,
                        label: option.name,
                        color: option.color,
                      })),
                    ]}
                  />
                </label>
              ))}
              {issue.projectsError && (
                <p className="inline-error" role="alert">
                  {issue.projectsError}
                </p>
              )}
              {!issue.projects.length && !issue.projectsError && (
                <p className="muted">No Project membership</p>
              )}
              <p className="property-note">
                Independent of the issue’s Open / Closed state.
              </p>
            </section>
            <section>
              <h2>Assignees</h2>
              <MultiSelect
                label="Assignees"
                value={issue.assignees}
                options={assigneeOptions}
                disabled={busy || !metadata}
                placeholder="Unassigned"
                placeholderLeading={<IssueAssigneeVisual />}
                onChange={(assignees) =>
                  void save("arco_update_issue", {
                    ...ref,
                    expectedUpdatedAt: issue.updatedAt,
                    patch: { assignees },
                  })
                }
              />
              {metadataError && (
                <p className="inline-error" role="alert">
                  {errorText(metadataError)}
                </p>
              )}
              {!metadata && !metadataError && (
                <p className="muted">Loading assignees…</p>
              )}
              {metadata && assigneeOptions.length === 0 && (
                <p className="muted">No assignable users.</p>
              )}
            </section>
            <section>
              <h2>Labels</h2>
              <MultiSelect
                label="Labels"
                value={issue.labels.map((label) => label.id)}
                options={labelOptions.map((label) => ({
                  value: label.id,
                  label: label.name,
                  color: label.color,
                  leading: <IssueLabelVisual color={label.color} />,
                }))}
                disabled={busy || !metadata}
                placeholder="None"
                placeholderLeading={<IssueLabelVisual />}
                onChange={(values) =>
                  void save("arco_change_labels", {
                    ...ref,
                    add: labelOptions
                      .filter(
                        (label) =>
                          values.includes(label.id) &&
                          !issue.labels.some(
                            (current) => current.id === label.id,
                          ),
                      )
                      .map((label) => label.name),
                    remove: issue.labels
                      .filter((label) => !values.includes(label.id))
                      .map((label) => label.name),
                  })
                }
              />
              {metadataError && (
                <p className="inline-error" role="alert">
                  {errorText(metadataError)}
                </p>
              )}
              {!metadata && !metadataError && (
                <p className="muted">Loading labels…</p>
              )}
              {metadata && labelOptions.length === 0 && (
                <p className="muted">No existing labels.</p>
              )}
            </section>
            <details className="property-advanced">
              <DisclosureSummary>More properties</DisclosureSummary>
              <GitHubProperties host={host} issue={issue} />
              <GitHubRelations host={host} issue={issue} />
              <LabelManager host={host} repo={issue.repo} />
            </details>
          </aside>
        </div>
      </div>
    </>
  );
}
