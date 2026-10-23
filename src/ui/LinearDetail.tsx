import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Edit,
  Expand,
  ExternalLink,
  Plus,
} from "@openai/apps-sdk-ui/components/Icon";
import { DetailToolbar, closeDetailUtility } from "./DetailToolbar";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { IssueMarkdown } from "./MarkdownContent";
import { toggleMarkdownTask } from "./markdown-tasks";
import { LinearCommentEditor } from "./LinearCommentEditor";
import { CopyValue } from "./GitHubDiscussion";
import { MultiSelect } from "./MultiSelect";
import { SingleSelect } from "./SingleSelect";
import {
  DraftStatus,
  draftStorageId,
  useDraftPersistence,
} from "./useDraftPersistence";
import { resolveContentDraft, contentConflict } from "./content-drafts";
import type { ArcoHost } from "../shared/contracts";
import { LINEAR_UPLOAD_MAX_BYTES } from "../shared/linear";
import type {
  LinearComment,
  LinearConnection,
  LinearIssue,
  LinearMetadata,
  LinearRef,
} from "../shared/linear";
import type { Draft, DraftKey } from "../shared/state";

import { isSavedReceipt, type LinearRun } from "./linear-run";
import { DisclosureSummary } from "./DisclosureSummary";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const ref = (issue: LinearIssue) => ({
  connectionId: issue.connectionId,
  workspaceId: issue.workspaceId,
  teamId: issue.teamId,
  issueId: issue.issueId,
});
const reactionChoices = ["👍", "👎", "😄", "🎉", "❤️", "🚀", "👀"];

function LinearReactions({
  items,
  userId,
  comment,
  busy,
  onToggle,
}: {
  items: LinearIssue["reactions"];
  userId?: string | null;
  comment: boolean;
  busy: boolean;
  onToggle: (emoji: string, reactionId?: string) => Promise<unknown>;
}) {
  const picker = useRef<HTMLDetailsElement>(null);
  const target = comment ? "comment" : "Issue";
  const close = () => {
    if (!picker.current) return;
    picker.current.open = false;
    picker.current.querySelector("summary")?.focus();
  };
  const button = (emoji: string, choice = false) => {
    const matches = items.filter((item) => item.emoji === emoji);
    const own = matches.find((item) => item.userId === userId);
    return (
      <button
        key={emoji}
        type="button"
        aria-label={`${own ? "Remove" : "Add"} ${emoji} ${target} reaction`}
        aria-pressed={Boolean(own)}
        title={`${matches.length} reaction${matches.length === 1 ? "" : "s"}`}
        disabled={busy}
        onClick={() => {
          void onToggle(emoji, own?.id).then((result) => {
            if (choice && result !== undefined) close();
          });
        }}
      >
        {emoji}
        {matches.length > 0 && <span>{matches.length}</span>}
      </button>
    );
  };
  return (
    <div
      className="linear-reactions"
      role="group"
      aria-label={`${target} reactions`}
    >
      {[...new Set(items.map((item) => item.emoji))].map((emoji) =>
        button(emoji),
      )}
      <details
        ref={picker}
        className="linear-reaction-picker"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
      >
        <summary
          className="linear-reaction-add icon-button"
          aria-label={`Choose ${target} reaction`}
          title={`Choose ${target} reaction`}
        >
          <Plus />
        </summary>
        <div
          className="linear-reaction-options"
          role="group"
          aria-label={`${target} reaction choices`}
        >
          {reactionChoices.map((emoji) => button(emoji, true))}
        </div>
      </details>
    </div>
  );
}
function MarkdownBody({
  text,
  host,
  onError,
  issue,
  commentId,
  busy,
  onToggleTask,
}: {
  text: string;
  host: ArcoHost;
  onError: (text: string) => void;
  issue: LinearIssue;
  commentId?: string;
  busy?: boolean;
  onToggleTask?: (line: number, checked: boolean) => void;
}) {
  return (
    <IssueMarkdown
      body={text}
      image={{ host, issue, ...(commentId ? { commentId } : {}) }}
      busy={busy}
      onToggleTask={onToggleTask}
      onOpen={(url) =>
        void host.openLink(url).catch((error) => onError(errorText(error)))
      }
    />
  );
}

export function LinearDetail({
  feedback,
  shared,
  onBack,
  onFullscreen,
  host,
  issue,
  metadata,
  metadataError,
  connection,
  busy,
  run,
  onNotice,
}: {
  feedback: ReactNode;
  shared: (LinearRef & { identifier: string }) | null;
  onBack: () => void;
  onFullscreen: () => void;
  host: ArcoHost;
  issue: LinearIssue;
  metadata?: LinearMetadata;
  metadataError: Error | null;
  connection?: LinearConnection;
  busy: boolean;
  run: LinearRun;
  onNotice: (message: string) => void;
}) {
  const [storedDraft, setStoredDraft] = useState<Draft>({
    title: issue.title,
    body: issue.body,
    comment: "",
  });
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [commentEdit, setCommentEdit] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [hostBusy, setHostBusy] = useState(false);

  const [relationTarget, setRelationTarget] = useState("");
  const [relationKind, setRelationKind] = useState<
    "blocks" | "blocked-by" | "related"
  >("related");
  const [parentId, setParentId] = useState("");
  const [child, setStoredChild] = useState({ title: "", body: "" });
  const childRef = useRef(child);
  const childTouched = useRef(false);
  const [labelDraft, setLabelDraft] = useState({
    id: "",
    name: "",
    color: "#8b8b8b",
    description: "",
    scope: "team",
  });
  const touched = useRef(false);
  const draftRef = useRef(storedDraft);
  const root = useRef<HTMLDivElement>(null);
  const hostLock = useRef(false);
  const persistence = useDraftPersistence(host);
  const { load } = persistence;
  const key: DraftKey = useMemo(
    () => ({
      source: "linear",
      workspaceId: issue.workspaceId,
      teamId: issue.teamId,
      issue: issue.issueId,
    }),
    [issue.workspaceId, issue.teamId, issue.issueId],
  );
  const childKey = useMemo<DraftKey>(
    () => ({ ...key, issue: `child:${issue.issueId}` }),
    [key, issue.issueId],
  );
  useEffect(() => {
    let alive = true;
    void load(childKey).then((saved) => {
      if (!alive || !saved || childTouched.current) return;
      const next = { title: saved.title, body: saved.body };
      childRef.current = next;
      setStoredChild(next);
    });
    return () => {
      alive = false;
    };
  }, [load, childKey]);
  const setChild = (
    update: typeof child | ((previous: typeof child) => typeof child),
  ) => {
    const next =
      typeof update === "function" ? update(childRef.current) : update;
    childTouched.current = true;
    childRef.current = next;
    setStoredChild(next);
    persistence.schedule(childKey, { ...next, comment: "" });
  };
  useEffect(() => {
    let alive = true;
    void load(key).then((saved) => {
      if (alive && saved && !touched.current) {
        draftRef.current = saved;
        setStoredDraft(saved);
        if (saved.baseUpdatedAt) setEditing(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [load, key]);
  const draft = resolveContentDraft(issue, storedDraft);
  const dirty = draft.title !== issue.title || draft.body !== issue.body;
  const conflict = contentConflict(issue, draft);
  const labelsById = new Map(
    [...issue.labels, ...(metadata?.labels ?? [])].map((label) => [
      label.id,
      label,
    ]),
  );
  const labelOptions = [...labelsById.values()]
    .filter((label) => !label.isGroup)
    .map((label) => ({
      value: label.id,
      label: `${label.name}${label.teamId ? "" : " · workspace"}`,
      color: label.color,
      disabled: !metadata?.labels.some(
        (available) => available.id === label.id,
      ),
    }));
  const replyTo = draft.linearReplyTo ?? null;
  const setReplyTo = (value: string | null) =>
    edit({ linearReplyTo: value ?? undefined });
  function persist(next: Draft) {
    touched.current = true;
    draftRef.current = next;
    setStoredDraft(next);
    persistence.schedule(key, next);
  }
  function edit(patch: Partial<Draft>) {
    const current = resolveContentDraft(issue, draftRef.current);
    const content = "title" in patch || "body" in patch;
    persist({
      ...current,
      ...(content && !current.baseUpdatedAt
        ? {
            baseTitle: issue.title,
            baseBody: issue.body,
            baseUpdatedAt: issue.updatedAt,
          }
        : {}),
      ...patch,
    });
  }
  async function hostAction(action: () => Promise<void>, success: string) {
    if (hostLock.current) return;
    hostLock.current = true;
    setHostBusy(true);
    try {
      await action();
      onNotice(success);
    } catch (error) {
      onNotice(errorText(error));
    } finally {
      hostLock.current = false;
      setHostBusy(false);
    }
  }
  const update = (patch: Record<string, unknown>) =>
    run<LinearIssue>("linear_update_issue", {
      ...ref(issue),
      expectedUpdatedAt: issue.updatedAt,
      patch,
    });
  const share = () =>
    hostAction(() => host.share(issue), `${issue.identifier} added to chat.`);
  function reactions(items: LinearIssue["reactions"], commentId?: string) {
    return (
      <LinearReactions
        items={items}
        userId={connection?.userId}
        comment={Boolean(commentId)}
        busy={busy}
        onToggle={(emoji, reactionId) =>
          run("linear_reaction", {
            ...ref(issue),
            action: reactionId ? "remove" : "add",
            emoji,
            ...(commentId ? { commentId } : {}),
            ...(reactionId ? { reactionId } : {}),
          })
        }
      />
    );
  }
  function commentView(
    comment: LinearComment,
    seen = new Set<string>(),
  ): React.ReactNode {
    if (seen.has(comment.id)) return null;
    const next = new Set(seen).add(comment.id);
    return (
      <article
        className={`linear-comment ${comment.parentId ? "linear-comment-reply" : ""}`}
        key={comment.id}
      >
        <div className="linear-comment-header">
          <strong>{comment.author}</strong>
          <time>{new Date(comment.updatedAt).toLocaleString("en-US")}</time>
          <CopyValue value={comment.url} />
          <CopyValue value={comment.id} label="Copy comment ID" />
          <button
            className="text-button"
            onClick={() =>
              void hostAction(
                () => host.openLink(comment.url),
                "Opened comment in Linear.",
              )
            }
          >
            ↗
          </button>
        </div>
        {commentEdit?.id === comment.id ? (
          <LinearCommentEditor
            host={host}
            issue={issue}
            comment={comment}
            busy={busy}
            run={run}
            onClose={() => setCommentEdit(null)}
            onError={onNotice}
          />
        ) : (
          <div data-linear-context="comment" data-comment-id={comment.id}>
            <MarkdownBody
              text={comment.body}
              host={host}
              issue={issue}
              commentId={comment.id}
              onError={onNotice}
            />
          </div>
        )}
        {reactions(comment.reactions, comment.id)}
        <div className="linear-controls">
          <button
            className="text-button"
            onClick={() => {
              setReplyTo(comment.id);
              root.current
                ?.querySelector<HTMLTextAreaElement>("[data-comment-composer]")
                ?.focus();
            }}
          >
            Reply
          </button>
          {comment.authorId === connection?.userId && (
            <>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  setCommentEdit({ id: comment.id, text: comment.body })
                }
              >
                Edit
              </button>
              <details>
                <DisclosureSummary>Delete</DisclosureSummary>
                <p>Delete this comment from Linear.</p>
                <Button
                  color="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run("linear_comment", {
                      ...ref(issue),
                      action: "delete",
                      commentId: comment.id,
                      expectedUpdatedAt: comment.updatedAt,
                    })
                  }
                >
                  Delete this comment
                </Button>
              </details>
            </>
          )}
        </div>
        {issue.comments
          .filter((child) => child.parentId === comment.id)
          .map((child) => commentView(child, next))}
      </article>
    );
  }
  return (
    <>
      <DetailToolbar
        tab="Linear Issue"
        backLabel="Back to Linear list"
        onBack={onBack}
        shared={
          shared ? (
            <span className="shared-chip" title={shared.identifier}>
              Chat {shared.identifier}
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
              aria-label="Edit Linear description"
              onClick={() => setEditing(true)}
            >
              <Edit aria-hidden="true" /> Edit description
            </button>
            <div className="utility-item">
              <CopyValue
                value={`${issue.identifier} ${issue.url}`}
                label="Copy identifier and link"
                onCopied={closeDetailUtility}
              />
            </div>
            <button
              className="utility-item"
              aria-label="Open in Linear"
              onClick={() =>
                void hostAction(
                  () => host.openLink(issue.url),
                  "Opened Linear.",
                )
              }
            >
              <ExternalLink aria-hidden="true" /> Open in Linear
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
      <div className="detail-scroll motion-content" ref={root}>
        <div className="issue-heading">
          <div className="issue-kicker">
            <span className="state-pill" style={{ color: issue.state.color }}>
              {issue.state.name}
            </span>
            <span>{issue.identifier}</span>
          </div>
          <div className="title-line">
            <h1>{issue.title}</h1>
          </div>
          <p className="author-line">
            <strong>{issue.author}</strong>
            <span>
              Updated {new Date(issue.updatedAt).toLocaleString("en-US")}
            </span>
            {dirty && <span className="draft-mark">Unsaved draft</span>}
          </p>
          {shared && (
            <div className="shared-target">
              Shared issue: <strong>{shared.identifier}</strong>
              {(shared.connectionId !== issue.connectionId ||
                shared.workspaceId !== issue.workspaceId ||
                shared.teamId !== issue.teamId ||
                shared.issueId !== issue.issueId) && (
                <span> · Different from the issue you are browsing</span>
              )}
            </div>
          )}
        </div>
        <DraftStatus
          status={persistence.statuses[draftStorageId(key)]}
          onRetry={() => persistence.retry(key, draft)}
          onResolve={(choice) => {
            void persistence.resolve(key, choice, draft).then((saved) => {
              if (saved === undefined) return;
              const next = saved ?? {
                title: issue.title,
                body: issue.body,
                comment: "",
              };
              draftRef.current = next;
              setStoredDraft(next);
              touched.current = Boolean(saved);
            });
          }}
        />
        <div className="issue-columns">
          <div className="issue-main">
            {editing ? (
              <section className="linear-body-editor">
                <label>
                  Title
                  <input
                    aria-label="Linear title"
                    value={draft.title}
                    disabled={busy}
                    onChange={(event) => edit({ title: event.target.value })}
                  />
                </label>
                <div className="linear-controls" data-motion="selection">
                  <button
                    className="text-button"
                    onClick={() => setPreview(false)}
                  >
                    Markdown
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setPreview(true)}
                  >
                    Preview
                  </button>
                </div>
                {preview ? (
                  <MarkdownBody
                    text={draft.body}
                    host={host}
                    issue={issue}
                    onError={onNotice}
                  />
                ) : (
                  <textarea
                    rows={14}
                    aria-label="Linear Markdown description"
                    value={draft.body}
                    disabled={busy}
                    onChange={(event) => edit({ body: event.target.value })}
                  />
                )}
                {conflict && (
                  <div className="linear-conflict" role="alert">
                    <p>
                      The title or description changed in Linear. Your draft is
                      preserved.
                    </p>
                    <details>
                      <DisclosureSummary>
                        Compare latest description
                      </DisclosureSummary>
                      <pre>{issue.body}</pre>
                    </details>
                    <button
                      className="text-button"
                      onClick={() =>
                        persist({
                          ...draft,
                          baseTitle: issue.title,
                          baseBody: issue.body,
                          baseUpdatedAt: issue.updatedAt,
                        })
                      }
                    >
                      Keep draft and rebase on latest version
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        persist({
                          ...draft,
                          title: issue.title,
                          body: issue.body,
                          baseTitle: undefined,
                          baseBody: undefined,
                          baseUpdatedAt: undefined,
                        })
                      }
                    >
                      Use latest description
                    </button>
                  </div>
                )}
                <div className="linear-controls">
                  <Button
                    color="primary"
                    size="sm"
                    disabled={busy || conflict || !dirty || !draft.title.trim()}
                    onClick={() =>
                      void run<LinearIssue>("linear_update_issue", {
                        ...ref(issue),
                        expectedUpdatedAt: conflict
                          ? draft.baseUpdatedAt
                          : issue.updatedAt,
                        patch: {
                          ...(draft.title !== issue.title
                            ? { title: draft.title }
                            : {}),
                          ...(draft.body !== issue.body
                            ? { body: draft.body }
                            : {}),
                        },
                      }).then((result) => {
                        if (result && !isSavedReceipt(result)) {
                          persist({
                            ...draft,
                            title: result.title,
                            body: result.body,
                            baseUpdatedAt: undefined,
                            baseTitle: undefined,
                            baseBody: undefined,
                          });
                          setEditing(false);
                        }
                      })
                    }
                  >
                    Save to Linear
                  </Button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    Close and keep draft
                  </button>
                </div>
              </section>
            ) : (
              <div className="body-content" data-linear-context="body">
                <MarkdownBody
                  text={issue.body}
                  host={host}
                  issue={issue}
                  onError={onNotice}
                  busy={busy || dirty}
                  onToggleTask={(line, checked) => {
                    const body = toggleMarkdownTask(issue.body, line, checked);
                    if (body !== issue.body) void update({ body });
                  }}
                />
              </div>
            )}
            {reactions(issue.reactions)}
            {issue.attachments.length > 0 && (
              <section className="linear-extra">
                <h2>Attachments and links</h2>
                {issue.attachments.map((attachment) => (
                  <p key={attachment.id}>
                    <button
                      className="text-button"
                      onClick={() =>
                        void hostAction(
                          () => host.openLink(attachment.url),
                          "Opened attachment.",
                        )
                      }
                    >
                      {attachment.title} ↗
                    </button>
                  </p>
                ))}
              </section>
            )}
            <details className="linear-extra linear-upload">
              <DisclosureSummary>Add file or URL</DisclosureSummary>
              <p className="muted">
                Files are stored in Linear. This Arco upload route supports
                files up to 10 MiB per request. Add URLs using the Markdown
                editor.
              </p>
              <input
                type="file"
                aria-label="Upload file to Linear"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > LINEAR_UPLOAD_MAX_BYTES) {
                    onNotice(
                      "This Arco upload route supports files up to 10 MiB. Open Linear for larger files.",
                    );
                    event.target.value = "";
                    return;
                  }
                  void file
                    .arrayBuffer()
                    .then((buffer) => {
                      const bytes = new Uint8Array(buffer);
                      let binary = "";
                      for (let i = 0; i < bytes.length; i += 0x8000)
                        binary += String.fromCharCode(
                          ...bytes.subarray(i, i + 0x8000),
                        );
                      return run("linear_upload", {
                        ...ref(issue),
                        filename: file.name,
                        contentType: file.type || "application/octet-stream",
                        base64: btoa(binary),
                      });
                    })
                    .catch((error) => onNotice(errorText(error)));
                  event.target.value = "";
                }}
              />
              <button
                className="text-button"
                onClick={() =>
                  void hostAction(
                    () => host.openLink(issue.url),
                    "Opened Linear for file upload.",
                  )
                }
              >
                Open Linear for larger files ↗
              </button>
            </details>
            <section className="comments-section">
              <h2>
                Comment {issue.comments.length}
                {issue.commentsHasMore ? "+" : ""}
              </h2>
              {issue.comments
                .filter(
                  (comment) =>
                    !comment.parentId ||
                    !issue.comments.some(
                      (parent) => parent.id === comment.parentId,
                    ),
                )
                .map((comment) => commentView(comment))}
              {issue.commentsHasMore && (
                <button
                  className="text-button"
                  onClick={() =>
                    void hostAction(
                      () => host.openLink(issue.url),
                      "Opened all comments in Linear.",
                    )
                  }
                >
                  View all comments in Linear ↗
                </button>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run<LinearIssue>("linear_comment", {
                    ...ref(issue),
                    action: "create",
                    body: draft.comment,
                    ...(replyTo ? { parentId: replyTo } : {}),
                  }).then((result) => {
                    if (result) {
                      persist({
                        ...draft,
                        comment: "",
                        linearReplyTo: undefined,
                      });
                    }
                  });
                }}
              >
                <label>
                  Comment in Linear
                  {replyTo && (
                    <span>
                      {" "}
                      · Reply{" "}
                      <button
                        className="text-button"
                        type="button"
                        aria-label="Cancel reply"
                        disabled={busy}
                        onClick={() => setReplyTo(null)}
                      >
                        Cancel
                      </button>
                    </span>
                  )}
                  <textarea
                    data-comment-composer
                    rows={4}
                    aria-label="Linear comment"
                    disabled={busy}
                    value={draft.comment}
                    onChange={(event) => edit({ comment: event.target.value })}
                  />
                </label>
                <Button
                  type="submit"
                  color="primary"
                  size="sm"
                  disabled={busy || !draft.comment.trim()}
                >
                  Post comment to Linear
                </Button>
              </form>
            </section>
          </div>
          <aside className="issue-properties linear-properties">
            {metadataError && (
              <p role="alert" className="inline-error">
                {errorText(metadataError)}
              </p>
            )}
            <label>
              Workflow state
              <SingleSelect
                label="Linear Workflow state"
                disabled={busy || issue.state.type === "duplicate"}
                value={issue.state.id}
                options={(metadata?.states ?? []).map((state) => ({
                  value: state.id,
                  label: state.name,
                  disabled: state.type === "duplicate",
                }))}
                onChange={(value) => void update({ stateId: value })}
              />
            </label>
            {issue.state.type === "duplicate" && (
              <p className="property-note">
                This issue is marked as duplicate. Manage merge and duplicate
                state in Linear.
              </p>
            )}
            <label>
              Assignee
              <SingleSelect
                label="Linear assignee"
                disabled={busy}
                value={issue.assignee?.id ?? ""}
                options={[
                  { value: "", label: "Unassigned" },
                  ...(metadata?.members ?? []).map((member) => ({
                    value: member.id,
                    label: member.name,
                  })),
                ]}
                onChange={(value) => void update({ assigneeId: value || null })}
              />
            </label>
            <label>
              Priority
              <SingleSelect
                label="Linear Priority"
                disabled={busy}
                value={String(issue.priority)}
                options={["No priority", "Urgent", "High", "Normal", "Low"].map(
                  (label, value) => ({ value: String(value), label }),
                )}
                onChange={(value) => void update({ priority: Number(value) })}
              />
            </label>
            <section>
              <h2>Labels</h2>
              <MultiSelect
                label="Labels"
                value={issue.labels.map((label) => label.id)}
                options={labelOptions}
                disabled={busy || !metadata}
                loading={busy}
                placeholder="No labels"
                onChange={(values) => {
                  const add = values.filter(
                    (value) =>
                      !issue.labels.some((label) => label.id === value),
                  );
                  const remove = issue.labels
                    .filter((label) => !values.includes(label.id))
                    .map((label) => label.id);
                  if (add.length || remove.length)
                    void run("linear_change_labels", {
                      ...ref(issue),
                      add,
                      remove,
                    });
                }}
              />
            </section>
            <details className="property-advanced">
              <DisclosureSummary>More properties</DisclosureSummary>
              <label>
                Estimate
                <SingleSelect
                  label="Linear Estimate"
                  disabled={busy || !metadata?.estimateValues.length}
                  value={issue.estimate == null ? "" : String(issue.estimate)}
                  options={[
                    { value: "", label: "Not set" },
                    ...(metadata?.estimateValues ?? []).map((value) => ({
                      value: String(value),
                      label: String(value),
                    })),
                  ]}
                  onChange={(value) =>
                    void update({
                      estimate: value === "" ? null : Number(value),
                    })
                  }
                />
              </label>
              <label>
                Due date
                <input
                  aria-label="Linear Due date"
                  type="date"
                  disabled={busy}
                  value={issue.dueDate ?? ""}
                  onChange={(event) =>
                    void update({ dueDate: event.target.value || null })
                  }
                />
              </label>
              {(["project", "cycle", "projectMilestone"] as const).map(
                (property) => (
                  <label key={property}>
                    {property === "projectMilestone"
                      ? "Project milestone"
                      : property === "cycle"
                        ? "Cycle"
                        : "Project"}
                    <SingleSelect
                      label={`Linear ${property}`}
                      disabled={busy}
                      value={issue[property]?.id ?? ""}
                      options={[
                        { value: "", label: "None" },
                        ...(
                          (property === "project"
                            ? metadata?.projects
                            : property === "cycle"
                              ? metadata?.cycles
                              : metadata?.milestones.filter(
                                  (milestone) =>
                                    milestone.projectId === issue.project?.id,
                                )) ?? []
                        ).map((item) => ({ value: item.id, label: item.name })),
                      ]}
                      onChange={(value) =>
                        void update({
                          [`${property}Id`]: value || null,
                        })
                      }
                    />
                  </label>
                ),
              )}
              <details className="linear-extra">
                <DisclosureSummary>Manage label definitions</DisclosureSummary>
                <p className="muted">
                  Definitions apply across Issues. Manage label groups and scope
                  changes in Linear.
                </p>
                <label>
                  Definition
                  <SingleSelect
                    label="Linear label definition"
                    value={labelDraft.id}
                    options={[
                      { value: "", label: "New label" },
                      ...(metadata?.labels ?? [])
                        .filter((label) => !label.isGroup)
                        .map((label) => ({
                          value: label.id,
                          label: `${label.name} · ${label.teamId ? "team" : "workspace"}`,
                        })),
                    ]}
                    onChange={(value) => {
                      const label = metadata?.labels.find(
                        (item) => item.id === value,
                      );
                      setLabelDraft(
                        label
                          ? {
                              id: label.id,
                              name: label.name,
                              color: label.color,
                              description: label.description ?? "",
                              scope: label.teamId ? "team" : "workspace",
                            }
                          : {
                              id: "",
                              name: "",
                              color: "#8b8b8b",
                              description: "",
                              scope: "team",
                            },
                      );
                    }}
                  />
                </label>
                <label>
                  Name
                  <input
                    value={labelDraft.name}
                    disabled={busy}
                    onChange={(event) =>
                      setLabelDraft((previous) => ({
                        ...previous,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Color
                  <input
                    type="color"
                    value={labelDraft.color}
                    disabled={busy}
                    onChange={(event) =>
                      setLabelDraft((previous) => ({
                        ...previous,
                        color: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Description
                  <input
                    value={labelDraft.description}
                    disabled={busy}
                    onChange={(event) =>
                      setLabelDraft((previous) => ({
                        ...previous,
                        description: event.target.value,
                      }))
                    }
                  />
                </label>
                {!labelDraft.id && (
                  <label>
                    Scope
                    <SingleSelect
                      label="Linear label scope"
                      value={labelDraft.scope}
                      options={[
                        { value: "team", label: "This team" },
                        { value: "workspace", label: "workspace" },
                      ]}
                      onChange={(value) =>
                        setLabelDraft((previous) => ({
                          ...previous,
                          scope: value,
                        }))
                      }
                    />
                  </label>
                )}
                <Button
                  color="secondary"
                  variant="outline"
                  size="sm"
                  disabled={busy || !labelDraft.name.trim()}
                  onClick={() =>
                    void run("linear_label_definition", {
                      connectionId: issue.connectionId,
                      workspaceId: issue.workspaceId,
                      teamId: issue.teamId,
                      action: labelDraft.id ? "update" : "create",
                      ...(labelDraft.id ? { labelId: labelDraft.id } : {}),
                      name: labelDraft.name,
                      color: labelDraft.color,
                      description: labelDraft.description,
                      scope: labelDraft.scope,
                    })
                  }
                >
                  {labelDraft.id ? "Save definition" : "Create definition"}
                </Button>
                {labelDraft.id && (
                  <details>
                    <DisclosureSummary>Delete definition</DisclosureSummary>
                    <p>
                      Delete “{labelDraft.name}” from this {labelDraft.scope}.
                      Issues will lose this label when its definition is
                      deleted.
                    </p>
                    <Button
                      color="danger"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run("linear_label_definition", {
                          connectionId: issue.connectionId,
                          workspaceId: issue.workspaceId,
                          teamId: issue.teamId,
                          action: "delete",
                          labelId: labelDraft.id,
                          scope: labelDraft.scope,
                        })
                      }
                    >
                      Delete this label definition
                    </Button>
                  </details>
                )}
              </details>
              <details className="linear-extra">
                <DisclosureSummary>
                  Parent, sub-issues and relations
                </DisclosureSummary>
                <p>
                  Parent:{" "}
                  {issue.parent
                    ? `${issue.parent.identifier} ${issue.parent.title}`
                    : "None"}
                </p>
                {issue.parent && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void update({ parentId: null })}
                  >
                    Remove parent
                  </button>
                )}
                <div className="linear-controls">
                  <input
                    aria-label="Linear parent Issue ID"
                    value={parentId}
                    onChange={(event) => setParentId(event.target.value)}
                    placeholder="Parent Issue ID / ABC-123"
                  />
                  <Button
                    color="secondary"
                    variant="outline"
                    size="sm"
                    disabled={busy || !parentId.trim()}
                    onClick={() => void update({ parentId: parentId.trim() })}
                  >
                    Set or replace parent
                  </Button>
                </div>
                {issue.children.map((child) => (
                  <p key={child.id}>
                    {child.identifier} {child.title}
                  </p>
                ))}
                <details>
                  <DisclosureSummary>Create sub-issue</DisclosureSummary>
                  <DraftStatus
                    status={persistence.statuses[draftStorageId(childKey)]}
                    onRetry={() =>
                      persistence.retry(childKey, { ...child, comment: "" })
                    }
                    onResolve={(choice) => {
                      void persistence
                        .resolve(childKey, choice, { ...child, comment: "" })
                        .then((saved) => {
                          if (saved === undefined) return;
                          const next = {
                            title: saved?.title ?? "",
                            body: saved?.body ?? "",
                          };
                          childTouched.current = true;
                          childRef.current = next;
                          setStoredChild(next);
                        });
                    }}
                  />
                  <label>
                    Title
                    <input
                      disabled={busy}
                      aria-label="Sub-issue title"
                      value={child.title}
                      onChange={(event) =>
                        setChild((previous) => ({
                          ...previous,
                          title: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      disabled={busy}
                      aria-label="Sub-issue description"
                      value={child.body}
                      onChange={(event) =>
                        setChild((previous) => ({
                          ...previous,
                          body: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <Button
                    color="secondary"
                    variant="outline"
                    size="sm"
                    disabled={busy || !child.title.trim()}
                    onClick={() =>
                      void run<LinearIssue>("linear_create_issue", {
                        connectionId: issue.connectionId,
                        workspaceId: issue.workspaceId,
                        teamId: issue.teamId,
                        parentId: issue.issueId,
                        ...child,
                      }).then((result) => {
                        if (result) setChild({ title: "", body: "" });
                      })
                    }
                  >
                    Create sub-issue in Linear
                  </Button>
                </details>
                {issue.relations.map((relation) => (
                  <div key={relation.id}>
                    <span>
                      {relation.type}: {relation.identifier} {relation.title}
                    </span>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run("linear_relation", {
                          ...ref(issue),
                          action: "remove",
                          relationId: relation.id,
                          kind: ["blocks", "blocked-by"].includes(relation.type)
                            ? relation.type
                            : "related",
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="linear-controls">
                  <label>
                    Relation kind
                    <SingleSelect
                      label="Linear relation kind"
                      value={relationKind}
                      options={[
                        { value: "blocks", label: "blocks" },
                        { value: "blocked-by", label: "blocked by" },
                        { value: "related", label: "related" },
                      ]}
                      onChange={(value) =>
                        setRelationKind(
                          value === "blocks"
                            ? "blocks"
                            : value === "blocked-by"
                              ? "blocked-by"
                              : "related",
                        )
                      }
                    />
                  </label>
                  <input
                    aria-label="Related Linear Issue ID"
                    value={relationTarget}
                    onChange={(event) => setRelationTarget(event.target.value)}
                    placeholder="Issue ID / ABC-123"
                  />
                  <Button
                    color="secondary"
                    variant="outline"
                    size="sm"
                    disabled={busy || !relationTarget.trim()}
                    onClick={() =>
                      void run("linear_relation", {
                        ...ref(issue),
                        action: "add",
                        relatedIssueId: relationTarget.trim(),
                        kind: relationKind,
                      })
                    }
                  >
                    Add relation
                  </Button>
                </div>
              </details>
              <button
                className="text-button"
                onClick={() =>
                  void hostAction(
                    () => host.openLink(issue.url),
                    "Opened Linear.",
                  )
                }
              >
                Transfers, deletion and full history in Linear ↗
              </button>
            </details>
          </aside>
        </div>
      </div>
    </>
  );
}
