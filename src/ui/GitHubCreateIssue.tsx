import { useEffect, useMemo } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { ArcoHost, IssueDetail } from "../shared/contracts";
import type { DraftKey, Draft } from "../shared/state";
import {
  DraftStatus,
  draftStorageId,
  useDraftPersistence,
} from "./useDraftPersistence";
import { CreateDialog } from "./CreateDialog";
import { TemplatePicker, type TemplateDraft } from "./TemplatePicker";
import { Notice, type NoticeValue } from "./Notice";
export function GitHubCreateIssue({
  host,
  ownerId,
  repo,
  open,
  busy,
  fixture,
  notice,
  save,
  onClose,
  onCreated,
}: {
  host: ArcoHost;
  ownerId: string;
  repo: string;
  open: boolean;
  busy: boolean;
  fixture: boolean;
  notice: NoticeValue | null;
  save: (
    name: string,
    args: Record<string, unknown>,
    after?: (result: IssueDetail) => void,
  ) => Promise<void>;
  onClose: () => void;
  onCreated: (issue: IssueDetail) => void;
}) {
  const persistence = useDraftPersistence(host);
  const { load: loadDraft, schedule: scheduleDraft } = persistence;
  const createDraftKey = useMemo<DraftKey | null>(
    () => (repo ? { source: "github", repo, issue: "new", ownerId } : null),
    [repo, ownerId],
  );
  useEffect(() => {
    if (open && createDraftKey) void loadDraft(createDraftKey);
  }, [open, createDraftKey, loadDraft]);
  const readCreateDraft = (): TemplateDraft => {
    const saved = createDraftKey
      ? persistence.value(createDraftKey)
      : undefined;
    return {
      title: saved?.title ?? "",
      body: saved?.body ?? "",
      labels: saved?.githubLabels ?? [],
      assignees: saved?.githubAssignees ?? [],
      issueTypeName: saved?.githubIssueTypeName ?? "",
    };
  };
  const toSavedDraft = (draft: TemplateDraft): Draft => ({
    title: draft.title,
    body: draft.body,
    comment: "",
    githubLabels: draft.labels,
    githubAssignees: draft.assignees,
    githubIssueTypeName: draft.issueTypeName || undefined,
  });
  const createDraft = readCreateDraft();
  const setCreateDraft = (
    value: TemplateDraft | ((previous: TemplateDraft) => TemplateDraft),
  ) => {
    if (!createDraftKey) return;
    const next = typeof value === "function" ? value(readCreateDraft()) : value;
    scheduleDraft(createDraftKey, toSavedDraft(next));
  };

  return (
    <CreateDialog
      open={open}
      busy={busy}
      title="Create issue"
      titleId="create-title"
      closeLabel="Close create issue"
      onClose={onClose}
      scope={
        <>
          Create in: {repo} {fixture && "· Local fixture"}
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            "arco_create_issue",
            {
              repo,
              title: createDraft.title,
              body: createDraft.body,
              labels: createDraft.labels,
              assignees: createDraft.assignees,
              ...(createDraft.issueTypeName
                ? { issueTypeName: createDraft.issueTypeName }
                : {}),
            },
            (result) => {
              onCreated(result);
              setCreateDraft({
                title: "",
                body: "",
                labels: [],
                assignees: [],
                issueTypeName: "",
              });
              onClose();
            },
          );
        }}
      >
        {createDraftKey && (
          <DraftStatus
            status={persistence.statuses[draftStorageId(createDraftKey)]}
            onRetry={() =>
              persistence.retry(createDraftKey, toSavedDraft(readCreateDraft()))
            }
            onResolve={(choice) => {
              void persistence.resolve(
                createDraftKey,
                choice,
                toSavedDraft(readCreateDraft()),
              );
            }}
          />
        )}
        <TemplatePicker
          host={host}
          repo={repo}
          disabled={busy}
          onApply={setCreateDraft}
        />
        {(createDraft.labels.length > 0 ||
          createDraft.assignees.length > 0 ||
          Boolean(createDraft.issueTypeName)) && (
          <div className="template-defaults">
            <strong>Initial attributes</strong>
            {createDraft.issueTypeName && (
              <button
                type="button"
                className="label"
                disabled={busy}
                title="Remove initial issue type"
                onClick={() =>
                  setCreateDraft((previous) => ({
                    ...previous,
                    issueTypeName: "",
                  }))
                }
              >
                Issue type: {createDraft.issueTypeName} ×
              </button>
            )}
            <div>
              {createDraft.labels.map((name) => (
                <button
                  type="button"
                  className="label"
                  key={name}
                  disabled={busy}
                  title="Remove initial label"
                  onClick={() =>
                    setCreateDraft((previous) => ({
                      ...previous,
                      labels: previous.labels.filter((value) => value !== name),
                    }))
                  }
                >
                  {name} ×
                </button>
              ))}
            </div>
            <div>
              {createDraft.assignees.map((name) => (
                <button
                  type="button"
                  className="label"
                  key={name}
                  disabled={busy}
                  title="Remove initial assignee"
                  onClick={() =>
                    setCreateDraft((previous) => ({
                      ...previous,
                      assignees: previous.assignees.filter(
                        (value) => value !== name,
                      ),
                    }))
                  }
                >
                  Assignee: {name} ×
                </button>
              ))}
            </div>
          </div>
        )}
        <label>
          Title
          <input
            autoFocus
            required
            maxLength={256}
            disabled={busy}
            value={createDraft.title}
            onChange={(event) =>
              setCreateDraft((previous) => ({
                ...previous,
                title: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Body
          <textarea
            rows={9}
            disabled={busy}
            value={createDraft.body}
            onChange={(event) =>
              setCreateDraft((previous) => ({
                ...previous,
                body: event.target.value,
              }))
            }
          />
        </label>
        <p className="muted">
          Markdown is supported. Use GitHub for complex issue forms.
        </p>
        <Notice notice={notice?.kind === "error" ? notice : null} />
        <div className="dialog-actions">
          <Button
            color="secondary"
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            type="submit"
            color="primary"
            disabled={!createDraft.title.trim() || busy}
            loading={busy}
          >
            {fixture ? "Create fixture issue" : "Create on GitHub"}
          </Button>
        </div>
      </form>
    </CreateDialog>
  );
}
