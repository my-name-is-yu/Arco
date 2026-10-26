import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { ArcoHost } from "../shared/contracts";
import type { LinearComment, LinearIssue } from "../shared/linear";
import type { Draft, DraftKey } from "../shared/state";
import { IssueMarkdown } from "./MarkdownContent";
import {
  DraftStatus,
  draftStorageId,
  useDraftPersistence,
} from "./useDraftPersistence";

import type { LinearRun } from "./linear-run";
export function LinearCommentEditor({
  host,
  ownerId,
  issue,
  comment,
  busy,
  run,
  onClose,
  onError,
}: {
  host: ArcoHost;
  ownerId: string;
  issue: LinearIssue;
  comment: LinearComment;
  busy: boolean;
  run: LinearRun;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const persistence = useDraftPersistence(host);
  const { load } = persistence;
  const key = useMemo<DraftKey>(
    () => ({
      source: "linear",
      ownerId,
      workspaceId: issue.workspaceId,
      teamId: issue.teamId,
      issue: `${issue.issueId}:comment:${comment.id}`,
    }),
    [issue.workspaceId, issue.teamId, issue.issueId, comment.id, ownerId],
  );
  // Older drafts can omit source baselines; freeze those fallbacks when editing starts.
  const [baseBody, setBaseBody] = useState(comment.body);
  const [revision, setRevision] = useState(comment.updatedAt);
  const touched = useRef(false);
  const [compare, setCompare] = useState(false);
  useEffect(() => {
    let active = true;
    void load(key).then((saved) => {
      if (!active || !saved || touched.current) return;
      setBaseBody(saved.baseBody ?? comment.body);
      setRevision(saved.baseUpdatedAt ?? comment.updatedAt);
      touched.current = true;
    });
    return () => {
      active = false;
    };
  }, [key, load, comment.body, comment.updatedAt]);
  const current = persistence.value(key)?.comment ?? comment.body;
  const conflict =
    touched.current && comment.body !== baseBody && comment.body !== current;
  const diskDraft = (
    text = current,
    original = baseBody,
    updatedAt = revision,
  ): Draft => ({
    title: "",
    body: "",
    comment: text,
    baseBody: original,
    baseUpdatedAt: updatedAt,
  });
  const persist = (text: string, original = baseBody, updatedAt = revision) => {
    touched.current = true;
    setBaseBody(original);
    setRevision(updatedAt);
    persistence.schedule(key, diskDraft(text, original, updatedAt));
  };
  return (
    <form
      className="linear-comment-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (conflict) return;
        void run<LinearIssue>("linear_comment", {
          connectionId: issue.connectionId,
          workspaceId: issue.workspaceId,
          teamId: issue.teamId,
          issueId: issue.issueId,
          action: "update",
          commentId: comment.id,
          body: current,
          expectedUpdatedAt: comment.updatedAt,
        }).then((result) => {
          if (result) {
            void persistence.remove(key);
            onClose();
          }
        });
      }}
    >
      <DraftStatus
        status={persistence.statuses[draftStorageId(key)]}
        onRetry={() => {
          const useSaved =
            persistence.statuses[draftStorageId(key)]?.retryChoice ===
            "use-saved";
          void persistence.retry(key, diskDraft()).then((saved) => {
            if (saved === undefined || (touched.current && !useSaved)) return;
            setBaseBody(saved?.baseBody ?? comment.body);
            setRevision(saved?.baseUpdatedAt ?? comment.updatedAt);
            touched.current = Boolean(saved);
          });
        }}
        onResolve={(choice) => {
          void persistence.resolve(key, choice, diskDraft()).then((saved) => {
            if (saved === undefined) return;
            setBaseBody(saved?.baseBody ?? comment.body);
            setRevision(saved?.baseUpdatedAt ?? comment.updatedAt);
            touched.current = Boolean(saved);
          });
        }}
      />
      <label>
        Edit Linear comment
        <textarea
          aria-label="Edit Linear comment"
          rows={4}
          disabled={
            busy ||
            persistence.statuses[draftStorageId(key)]?.state === "resolving"
          }
          value={current}
          onChange={(event) =>
            persist(
              event.target.value,
              touched.current ? baseBody : comment.body,
              touched.current ? revision : comment.updatedAt,
            )
          }
        />
      </label>
      {conflict && (
        <section className="linear-conflict" role="alert">
          <p>The comment changed in Linear. Your draft is preserved.</p>
          <button
            type="button"
            className="text-button"
            onClick={() => setCompare((value) => !value)}
          >
            Compare latest comment
          </button>
          {compare && (
            <>
              <IssueMarkdown
                body={comment.body}
                image={{ host, issue, commentId: comment.id }}
                onOpen={(url) =>
                  void host
                    .openLink(url)
                    .catch((error) =>
                      onError(
                        error instanceof Error ? error.message : String(error),
                      ),
                    )
                }
              />
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  persist(current, comment.body, comment.updatedAt);
                  setCompare(false);
                }}
              >
                Keep draft and use latest revision
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  persist(comment.body, comment.body, comment.updatedAt);
                  setCompare(false);
                }}
              >
                Use latest comment
              </button>
            </>
          )}
        </section>
      )}
      <div className="linear-controls">
        <Button
          type="submit"
          color="primary"
          size="sm"
          disabled={
            busy || conflict || !current.trim() || current === comment.body
          }
        >
          Save
        </Button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={onClose}
        >
          Close and keep draft
        </button>
      </div>
    </form>
  );
}
