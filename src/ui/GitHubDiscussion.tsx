import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { ArcoHost, Comment, IssueRef } from "../shared/contracts";
import type {
  GitHubOperationResult,
  ReactionList,
} from "../shared/github-operations";
import {
  DraftStatus,
  draftStorageId,
  useDraftPersistence,
} from "./useDraftPersistence";
import type { Draft, DraftKey } from "../shared/state";
import { useGitHubOperation } from "./useGitHubOperation";
import { useNearViewport } from "./useNearViewport";
import { CopyValue } from "./CopyValue";

const reactionNames = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  confused: "😕",
  heart: "❤️",
  hooray: "🎉",
  rocket: "🚀",
  eyes: "👀",
} as const;

export function ReactionBar({
  host,
  issue,
  commentId,
}: {
  host: ArcoHost;
  issue: IssueRef;
  commentId?: number;
}) {
  const [adding, setAdding] = useState(false);
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const input = {
    repo: issue.repo,
    number: issue.number,
    ...(commentId ? { commentId } : {}),
  };
  const query = useQuery({
    queryKey: ["github", "reactions", issue.repo, issue.number, commentId],
    queryFn: ({ signal }) =>
      host.call<ReactionList>("arco_reactions", input, {
        signal,
        priority: "background",
      }),
    enabled: near || adding,
  });
  const action = useGitHubOperation(
    host,
    ["reactions", issue.repo, issue.number, commentId ?? "issue"],
    issue,
  );
  return (
    <div
      ref={ref}
      className="reaction-bar"
      aria-label={commentId ? "Comment reactions" : "Issue reactions"}
    >
      {!query.data && !query.isError && (
        <span className="muted">
          {query.isFetching ? "Loading reactions…" : "Reactions not loaded"}
        </span>
      )}
      {Object.entries(reactionNames)
        .filter(
          ([content]) =>
            adding ||
            query.data?.reactions.some(
              (reaction) => reaction.content === content,
            ),
        )
        .map(([content, emoji]) => {
          const reactions =
            query.data?.reactions.filter(
              (reaction) => reaction.content === content,
            ) ?? [];
          const own = reactions.find(
            (reaction) => reaction.author === query.data?.account,
          );
          return (
            <button
              key={content}
              className={`reaction ${own ? "own" : ""}`}
              disabled={action.busy || !query.data}
              aria-label={`${content} ${reactions.length}${own ? " Remove my reaction" : " Add reaction"}`}
              aria-pressed={Boolean(own)}
              title={reactions.map((reaction) => reaction.author).join(", ")}
              onClick={() =>
                void action.run<GitHubOperationResult>(
                  own ? "arco_remove_reaction" : "arco_add_reaction",
                  { ...input, ...(own ? { reactionId: own.id } : { content }) },
                )
              }
            >
              {emoji}
              {reactions.length > 0 && <span>{reactions.length}</span>}
            </button>
          );
        })}
      <button
        className="text-button"
        aria-label="Choose reaction"
        aria-expanded={adding}
        onClick={() => setAdding((value) => !value)}
      >
        ☺ ＋
      </button>
      {query.isError && (
        <span className="inline-error" role="alert">
          {query.error.message}
        </span>
      )}
      {action.error && (
        <span className="inline-error" role="alert">
          {action.error}
        </span>
      )}
    </div>
  );
}

export function CommentActions({
  host,
  issue,
  comment,
}: {
  host: ArcoHost;
  issue: IssueRef;
  comment: Comment;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [revision, setRevision] = useState(comment.updatedAt);
  const persistence = useDraftPersistence(host);
  const { load } = persistence;
  const key = useMemo<DraftKey>(
    () => ({
      source: "github",
      repo: issue.repo,
      issue: `${issue.number}:comment:${comment.databaseId ?? comment.id}`,
    }),
    [issue.repo, issue.number, comment.databaseId, comment.id],
  );
  const touched = useRef(false);
  const status = persistence.statuses[draftStorageId(key)];
  const localDraft = (text = body, updatedAt = revision): Draft => ({
    title: "",
    body: "",
    comment: text,
    baseUpdatedAt: updatedAt,
  });
  useEffect(() => {
    if (!editing) return;
    void load(key).then((saved) => {
      if (saved && !touched.current) {
        setBody(saved.comment);
        setRevision(saved.baseUpdatedAt ?? comment.updatedAt);
        touched.current = true;
      }
    });
  }, [editing, key, load, comment.updatedAt]);

  const action = useGitHubOperation(
    host,
    ["comment", issue.repo, issue.number, comment.databaseId ?? comment.id],
    issue,
  );
  const supported = typeof comment.databaseId === "number";
  return (
    <section
      className="comment-tools"
      aria-label={`Actions for ${comment.author}’s comment`}
    >
      <div className="comment-tool-row">
        <CopyValue value={comment.url} />
        <CopyValue value={comment.id} label="Copy comment ID" />
        <button
          className="text-button"
          disabled={!supported || action.busy}
          onClick={() => {
            setEditing((value) => !value);
            if (!editing && !touched.current) {
              setBody(comment.body);
              setRevision(comment.updatedAt);
            }
          }}
        >
          Edit
        </button>
        <button
          className="text-button"
          disabled={!supported || action.busy}
          onClick={() => setConfirmDelete((value) => !value)}
        >
          Delete
        </button>
      </div>
      {editing && (
        <form
          className="comment-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run<GitHubOperationResult>(
              "arco_edit_comment",
              {
                repo: issue.repo,
                number: issue.number,
                commentId: comment.databaseId,
                body,
                expectedUpdatedAt: revision,
              },
              () => {
                touched.current = false;
                void persistence.remove(key);
                setEditing(false);
              },
            );
          }}
        >
          <DraftStatus
            status={status}
            onRetry={() => {
              const useSaved = status?.retryChoice === "use-saved";
              void persistence.retry(key, localDraft()).then((saved) => {
                if (saved === undefined || (touched.current && !useSaved))
                  return;
                setBody(saved?.comment ?? comment.body);
                setRevision(saved?.baseUpdatedAt ?? comment.updatedAt);
                touched.current = Boolean(saved);
              });
            }}
            onResolve={(choice) => {
              void persistence
                .resolve(key, choice, localDraft())
                .then((saved) => {
                  if (saved === undefined) return;
                  setBody(saved?.comment ?? comment.body);
                  setRevision(saved?.baseUpdatedAt ?? comment.updatedAt);
                  touched.current = Boolean(saved);
                });
            }}
          />
          <label>
            Edit comment
            <textarea
              rows={4}
              value={body}
              disabled={action.busy || status?.state === "resolving"}
              onChange={(event) => {
                touched.current = true;
                setBody(event.target.value);
                persistence.schedule(key, localDraft(event.target.value));
              }}
            />
          </label>
          {revision !== comment.updatedAt && (
            <p className="inline-error">
              The comment on GitHub changed. Compare it with your draft.
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setRevision(comment.updatedAt);
                  persistence.schedule(
                    key,
                    localDraft(body, comment.updatedAt),
                  );
                }}
              >
                Use latest revision for this draft
              </button>
            </p>
          )}
          <div className="editor-actions">
            <Button
              color="secondary"
              variant="ghost"
              size="sm"
              disabled={action.busy}
              onClick={() => setEditing(false)}
            >
              Close
            </Button>
            <Button
              color="primary"
              size="sm"
              type="submit"
              disabled={
                action.busy || !body.trim() || revision !== comment.updatedAt
              }
            >
              Update comment
            </Button>
          </div>
        </form>
      )}
      {confirmDelete && (
        <div className="delete-confirm">
          <p>
            Delete this comment from {issue.repo} #{issue.number} on GitHub.
          </p>
          <Button
            color="danger"
            variant="outline"
            size="sm"
            disabled={action.busy}
            onClick={() =>
              void action.run<GitHubOperationResult>(
                "arco_delete_comment",
                {
                  repo: issue.repo,
                  number: issue.number,
                  commentId: comment.databaseId,
                  expectedUpdatedAt: comment.updatedAt,
                },
                () => setConfirmDelete(false),
              )
            }
          >
            Delete this comment
          </Button>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </button>
        </div>
      )}
      {action.error && (
        <p className="inline-error" role="alert">
          {action.error}
        </p>
      )}
      {supported && (
        <ReactionBar host={host} issue={issue} commentId={comment.databaseId} />
      )}
      {!supported && (
        <p className="property-note">
          Edit or react to this comment on GitHub.
        </p>
      )}
    </section>
  );
}
