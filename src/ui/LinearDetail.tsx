import { LinearLabelManager } from "./LinearLabelManager";
import { LinearRelations } from "./LinearRelations";
import { MarkdownEditor } from "./MarkdownEditor";
import { ConflictPanel } from "./ConflictPanel";
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
import { CopyValue } from "./CopyValue";
import { MultiSelect } from "./MultiSelect";
import { SingleSelect } from "./SingleSelect";
import { linearPriorityLabels } from "./linear-priority";
import {
  IssueAssigneeVisual,
  IssueLabelVisual,
  IssuePriorityVisual,
  IssueStateVisual,
} from "./IssuePropertyVisual";
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
import { useLinearComments } from "./linear-comments";
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
  shared: (LinearRef & { identifier?: string; title?: string }) | null;
  onBack: () => void;
  onFullscreen: () => void;
  host: ArcoHost;
  issue: LinearIssue;
  metadata?: LinearMetadata;
  metadataError: Error | null;
  connection?: LinearConnection;
  busy: boolean;
  run: LinearRun;
  onNotice: (message: string, kind?: "error" | "info") => void;
}) {
  const discussion = useLinearComments(host, issue);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [commentEdit, setCommentEdit] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [hostBusy, setHostBusy] = useState(false);

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
  useEffect(() => {
    let alive = true;
    void load(key).then((saved) => {
      if (alive && saved?.baseUpdatedAt) setEditing(true);
    });
    return () => {
      alive = false;
    };
  }, [load, key]);
  const storedDraft = persistence.value(key) ?? {
    title: issue.title,
    body: issue.body,
    comment: "",
  };
  const draft = resolveContentDraft(issue, storedDraft);
  const dirty = draft.title !== issue.title || draft.body !== issue.body;
  const conflict = contentConflict(issue, draft);
  const states = [
    ...(metadata?.states ?? []),
    ...(!metadata?.states.some((state) => state.id === issue.state.id)
      ? [issue.state]
      : []),
  ];
  const members = [
    ...(metadata?.members ?? []),
    ...(issue.assignee &&
    !metadata?.members.some((member) => member.id === issue.assignee?.id)
      ? [issue.assignee]
      : []),
  ];
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
  const differentSharedTarget =
    shared &&
    (shared.connectionId !== issue.connectionId ||
      shared.workspaceId !== issue.workspaceId ||
      shared.teamId !== issue.teamId ||
      shared.issueId !== issue.issueId);
  const sharedLabel = shared?.identifier || shared?.title;
  const sharedDescription = `${sharedLabel ? `Shared issue: ${sharedLabel}` : "Shared issue"}${differentSharedTarget ? " · Different from the issue you are browsing" : ""}`;
  const setReplyTo = (value: string | null) =>
    edit({ linearReplyTo: value ?? undefined });
  function persist(next: Draft) {
    persistence.schedule(key, next);
  }
  function edit(patch: Partial<Draft>) {
    const current = resolveContentDraft(
      issue,
      persistence.value(key) ?? storedDraft,
    );
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
  async function hostAction(action: () => Promise<void>) {
    if (hostLock.current) return;
    hostLock.current = true;
    setHostBusy(true);
    onNotice("");
    try {
      await action();
    } catch (error) {
      onNotice(errorText(error), "error");
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
  function commentView(comment: LinearComment): React.ReactNode {
    const parent = comment.parentId
      ? discussion.comments.find((item) => item.id === comment.parentId)
      : undefined;
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
            onClick={() => void hostAction(() => host.openLink(comment.url))}
          >
            ↗
          </button>
        </div>
        {comment.parentId && (
          <small>{parent ? `Reply to ${parent.author}` : "Reply"}</small>
        )}
        {commentEdit?.id === comment.id ? (
          <LinearCommentEditor
            host={host}
            issue={issue}
            comment={comment}
            busy={busy}
            run={run}
            onClose={() => setCommentEdit(null)}
            onError={(text) => onNotice(text, "error")}
          />
        ) : (
          <div data-linear-context="comment" data-comment-id={comment.id}>
            <MarkdownBody
              text={comment.body}
              host={host}
              issue={issue}
              commentId={comment.id}
              onError={(text) => onNotice(text, "error")}
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
      </article>
    );
  }
  return (
    <>
      <DetailToolbar
        target={issue.identifier}
        backLabel="Back to Linear list"
        onBack={onBack}
        shared={
          shared ? (
            <span
              className="shared-chip"
              role="note"
              title={sharedDescription}
              aria-label={sharedDescription}
            >
              {differentSharedTarget
                ? sharedLabel
                  ? `Chat: ${sharedLabel}`
                  : "Shared issue"
                : "In chat"}
            </span>
          ) : undefined
        }
        primary={
          <Button
            color="primary"
            size="sm"
            disabled={hostBusy}
            onClick={() => void hostAction(() => host.share(issue))}
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
              onClick={() => void hostAction(() => host.openLink(issue.url))}
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
            {dirty && <span className="draft-mark">Unsaved changes</span>}
          </p>
        </div>
        <DraftStatus
          status={persistence.statuses[draftStorageId(key)]}
          onRetry={() => {
            void persistence.retry(key, draft).then((saved) => {
              if (saved?.baseUpdatedAt) setEditing(true);
            });
          }}
          onResolve={(choice) => {
            void persistence.resolve(key, choice, draft);
          }}
        />
        <div className="issue-columns">
          <div className="issue-main">
            {editing ? (
              <MarkdownEditor
                label="Edit Linear description"
                title={draft.title}
                body={draft.body}
                titleLabel="Linear title"
                bodyLabel="Linear Markdown description"
                busy={busy}
                preview={preview}
                onPreview={setPreview}
                onTitle={(title) => edit({ title })}
                onBody={(body) => edit({ body })}
                renderedBody={
                  <MarkdownBody
                    text={draft.body}
                    host={host}
                    issue={issue}
                    onError={(text) => onNotice(text, "error")}
                  />
                }
              >
                {conflict && (
                  <ConflictPanel
                    source="Linear"
                    latestTitle={issue.title}
                    latestBody={
                      <MarkdownBody
                        text={issue.body}
                        host={host}
                        issue={issue}
                        onError={(text) => onNotice(text, "error")}
                      />
                    }
                    busy={busy}
                    onKeep={() =>
                      persist({
                        ...draft,
                        baseTitle: issue.title,
                        baseBody: issue.body,
                        baseUpdatedAt: issue.updatedAt,
                      })
                    }
                    onUseLatest={() =>
                      persist({
                        ...draft,
                        title: issue.title,
                        body: issue.body,
                        baseTitle: undefined,
                        baseBody: undefined,
                        baseUpdatedAt: undefined,
                      })
                    }
                  />
                )}
                <div className="editor-actions">
                  <Button
                    color="primary"
                    size="sm"
                    loading={busy}
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
                    Save
                  </Button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    Close and keep draft
                  </button>
                </div>
              </MarkdownEditor>
            ) : (
              <div className="body-content" data-linear-context="body">
                <MarkdownBody
                  text={issue.body}
                  host={host}
                  issue={issue}
                  onError={(text) => onNotice(text, "error")}
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
                        void hostAction(() => host.openLink(attachment.url))
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
                Upload files up to 10 MiB to Linear. Add URLs in the description
                or a comment.
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
                      "Files up to 10 MiB can be uploaded here. Open Linear for larger files.",
                      "error",
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
                    .catch((error) => onNotice(errorText(error), "error"));
                  event.target.value = "";
                }}
              />
              <button
                className="text-button"
                onClick={() => void hostAction(() => host.openLink(issue.url))}
              >
                Open Linear for larger files ↗
              </button>
            </details>
            <section className="comments-section">
              <h2>
                Comment {discussion.comments.length}
                {discussion.hasNextPage ? "+" : ""}
              </h2>
              {discussion.comments.map((comment) => commentView(comment))}
              {discussion.isError && (
                <p role="alert">
                  Could not load comments. {errorText(discussion.error)}
                </p>
              )}
              {discussion.hasNextPage && (
                <button
                  className="text-button"
                  disabled={discussion.isFetching}
                  onClick={() => void discussion.fetchNextPage()}
                >
                  {discussion.isFetchingNextPage
                    ? "Loading comments…"
                    : "Load more comments"}
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
                  {replyTo && (
                    <span>
                      Reply{" "}
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
                    placeholder="Write a comment in Markdown…"
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
                  Comment
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
                options={states.map((state) => ({
                  value: state.id,
                  label: state.name,
                  disabled:
                    state.type === "duplicate" ||
                    !metadata?.states.some(
                      (available) => available.id === state.id,
                    ),
                  leading: (
                    <IssueStateVisual
                      source="linear"
                      state={state.type}
                      color={state.color}
                    />
                  ),
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
                  {
                    value: "",
                    label: "Unassigned",
                    leading: <IssueAssigneeVisual />,
                  },
                  ...members.map((member) => ({
                    value: member.id,
                    label: member.name,
                    disabled: !metadata?.members.some(
                      (available) => available.id === member.id,
                    ),
                    leading: <IssueAssigneeVisual name={member.name} />,
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
                options={linearPriorityLabels.map((label, value) => ({
                  value: String(value),
                  label,
                  empty: value === 0,
                  leading: <IssuePriorityVisual priority={value} />,
                }))}
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
                placeholderLeading={<IssueLabelVisual />}
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
                (property) => {
                  const current = issue[property];
                  const propertyLabel =
                    property === "projectMilestone"
                      ? "Project milestone"
                      : property === "cycle"
                        ? "Cycle"
                        : "Project";
                  const choices =
                    (property === "project"
                      ? metadata?.projects
                      : property === "cycle"
                        ? metadata?.cycles
                        : metadata?.milestones.filter(
                            (milestone) =>
                              milestone.projectId === issue.project?.id,
                          )) ?? [];
                  return (
                    <label key={property}>
                      {propertyLabel}
                      <SingleSelect
                        label={`Linear ${propertyLabel.toLowerCase()}`}
                        disabled={busy}
                        value={current?.id ?? ""}
                        options={[
                          { value: "", label: "None" },
                          ...choices.map((item) => ({
                            value: item.id,
                            label: item.name,
                          })),
                          ...(current &&
                          !choices.some((item) => item.id === current.id)
                            ? [
                                {
                                  value: current.id,
                                  label: current.name,
                                  disabled: true,
                                },
                              ]
                            : []),
                        ]}
                        onChange={(value) =>
                          void update({
                            [`${property}Id`]: value || null,
                          })
                        }
                      />
                    </label>
                  );
                },
              )}
              <LinearLabelManager
                host={host}
                issue={issue}
                metadata={metadata}
                busy={busy}
                run={run}
              />
              <LinearRelations
                host={host}
                issue={issue}
                busy={busy}
                run={run}
              />
              <button
                className="text-button"
                onClick={() => void hostAction(() => host.openLink(issue.url))}
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
