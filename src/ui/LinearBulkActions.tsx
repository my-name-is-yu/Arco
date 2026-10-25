import { useEffect } from "react";
import type { ArcoHost } from "../shared/contracts";
import { useSessionRef, useSessionState } from "./session-state";
import { SingleSelect } from "./SingleSelect";
import {
  IssueAssigneeVisual,
  IssuePriorityVisual,
  IssueStateVisual,
} from "./IssuePropertyVisual";
import { BulkActionPanel } from "./BulkActionPanel";
import type {
  LinearBulkMemberResult,
  LinearIssue,
  LinearMetadata,
  LinearScope,
} from "../shared/linear";

import { isSavedReceipt, type LinearRun } from "./linear-run";
import { useLinearIssueCache } from "./linear-queries";
type Result = LinearBulkMemberResult;
type IssueDisplay = Pick<LinearIssue, "issueId" | "identifier" | "title">;
type Action =
  | "state"
  | "assignee"
  | "label-add"
  | "label-remove"
  | "priority"
  | "estimate"
  | "due-date";
export function LinearBulkActions({
  host,
  scope,
  ids,
  issues,
  metadata,
  hasDuplicate,
  busy,
  run,
  onClear,
}: {
  host: ArcoHost;
  scope: LinearScope;
  ids: string[];
  issues: readonly IssueDisplay[];
  metadata?: LinearMetadata;
  hasDuplicate: boolean;
  busy: boolean;
  run: LinearRun;
  onClear: () => void;
}) {
  const displayScope = JSON.stringify([
    scope.connectionId,
    scope.workspaceId,
    scope.teamId,
  ]);
  const selectedIssues = useSessionRef(host, "linear:bulk:display", {
    scope: displayScope,
    issues: new Map<string, IssueDisplay>(),
  });
  useEffect(() => {
    if (selectedIssues.current.scope !== displayScope)
      selectedIssues.current = {
        scope: displayScope,
        issues: new Map(),
      };
    const selected = new Set(ids);
    for (const id of selectedIssues.current.issues.keys())
      if (!selected.has(id)) selectedIssues.current.issues.delete(id);
    for (const issue of issues)
      if (selected.has(issue.issueId))
        selectedIssues.current.issues.set(issue.issueId, issue);
  }, [displayScope, ids, issues, selectedIssues]);
  const issueLabel = (result: Result) => {
    const issue =
      (result.issue?.issueId === result.issueId ? result.issue : undefined) ??
      issues.find((issue) => issue.issueId === result.issueId) ??
      (selectedIssues.current.scope === displayScope
        ? selectedIssues.current.issues.get(result.issueId)
        : undefined);
    return issue ? `${issue.identifier} · ${issue.title}` : "Selected issue";
  };
  const sessionKey = `linear:bulk:${JSON.stringify([scope.connectionId, scope.workspaceId, scope.teamId, [...ids].sort()])}`;
  const [action, setAction] = useSessionState<Action>(
    host,
    `${sessionKey}:action`,
    "state",
  );
  const [value, setValue] = useSessionState(host, `${sessionKey}:value`, "");
  const [clearDate, setClearDate] = useSessionState(
    host,
    `${sessionKey}:clearDate`,
    false,
  );
  const [results, setResults] = useSessionState<Result[]>(
    host,
    `${sessionKey}:results`,
    [],
  );
  const [refreshing, setRefreshing] = useSessionState(
    host,
    `${sessionKey}:refreshing`,
    false,
  );
  const issueCache = useLinearIssueCache();
  const failures = results.filter((result) => !result.success);
  const retryableFailures = failures.filter(
    (result) => result.retryable === true,
  );
  const refreshFailures = results.filter((result) => result.refreshError);
  useEffect(() => {
    if (
      !busy &&
      !refreshing &&
      ids.length > 0 &&
      ids.every((id) =>
        results.some(
          (result) =>
            result.issueId === id && result.success && !result.refreshError,
        ),
      )
    ) {
      setResults([]);
      onClear();
    }
  }, [busy, refreshing, ids, results, setResults, onClear]);
  const changeValue = (next: string) => {
    setValue(next);
    setResults([]);
  };
  const refreshSaved = async () => {
    if (refreshing || busy) return;
    setRefreshing(true);
    try {
      const refreshed = await Promise.all(
        refreshFailures.map(async (result) => {
          try {
            const issue = await host.call<LinearIssue>(
              "linear_get_issue",
              { ...scope, issueId: result.issueId },
              { priority: "background" },
            );
            issueCache.remember(issue);
            return { ...result, issue, refreshError: undefined };
          } catch (error) {
            return {
              ...result,
              refreshError:
                error instanceof Error
                  ? error.message
                  : "Could not refresh this saved issue.",
            };
          }
        }),
      );
      setResults((previous) =>
        previous !== results
          ? previous
          : previous.map(
              (result) =>
                refreshed.find((next) => next.issueId === result.issueId) ??
                result,
            ),
      );
    } finally {
      setRefreshing(false);
    }
  };
  const labels = metadata?.labels.filter((label) => !label.isGroup) ?? [];
  const duplicate =
    metadata?.states.find((state) => state.id === value)?.type === "duplicate";
  const valid =
    ids.length > 0 &&
    ids.length <= 50 &&
    (action === "due-date"
      ? clearDate || /^\d{4}-\d{2}-\d{2}$/.test(value)
      : value !== "") &&
    !(action === "state" && (duplicate || hasDuplicate));
  const execute = async (failedOnly = false) => {
    if (
      !valid ||
      busy ||
      refreshing ||
      (!failedOnly && (failures.length || refreshFailures.length))
    )
      return;
    const targets = failedOnly
      ? ids.filter((id) =>
          retryableFailures.some((result) => result.issueId === id),
        )
      : ids;
    if (!targets.length) return;
    const change =
      action === "label-add"
        ? { addLabels: [value] }
        : action === "label-remove"
          ? { removeLabels: [value] }
          : {
              patch:
                action === "state"
                  ? { stateId: value }
                  : action === "assignee"
                    ? { assigneeId: value === "none" ? null : value }
                    : action === "priority"
                      ? { priority: Number(value) }
                      : action === "estimate"
                        ? { estimate: value === "none" ? null : Number(value) }
                        : { dueDate: clearDate ? null : value },
            };
    const result = await run<{ results: Result[] }>("linear_bulk", {
      ...scope,
      issueIds: targets,
      ...change,
    });
    if (result && !isSavedReceipt(result))
      setResults((previous) =>
        failedOnly
          ? previous.map(
              (old) =>
                result.results.find((next) => next.issueId === old.issueId) ??
                old,
            )
          : result.results,
      );
  };
  return (
    <BulkActionPanel
      label="Bulk Linear actions"
      count={ids.length}
      busy={busy}
      disabled={
        busy ||
        refreshing ||
        !valid ||
        failures.length > 0 ||
        refreshFailures.length > 0
      }
      onClear={onClear}
      onApply={() => void execute()}
      feedback={
        <>
          {refreshFailures.length > 0 && (
            <div>
              <ul
                className="bulk-refresh-results"
                aria-label="Saved issues requiring refresh"
                aria-live="polite"
              >
                {refreshFailures.map((result) => (
                  <li key={result.issueId}>
                    {issueLabel(result)}: {result.refreshError}
                  </li>
                ))}
              </ul>
              <button
                className="text-button"
                disabled={busy || refreshing}
                onClick={() => void refreshSaved()}
              >
                Refresh saved issues
              </button>
            </div>
          )}
          {failures.length > 0 && (
            <ul
              className="bulk-results"
              aria-label="Failed issues"
              aria-live="polite"
            >
              {failures.map((result) => (
                <li key={result.issueId} className="inline-error">
                  {issueLabel(result)}: {result.error}
                </li>
              ))}
            </ul>
          )}
          {retryableFailures.length > 0 && (
            <button
              className="text-button"
              disabled={busy || refreshing}
              onClick={() => void execute(true)}
            >
              Retry failed issues only
            </button>
          )}
        </>
      }
    >
      <div className="bulk-action-picker">
        <SingleSelect
          block
          label="Bulk Linear action"
          value={action}
          disabled={busy}
          options={[
            { value: "state", label: "Status" },
            { value: "assignee", label: "Assignee" },
            { value: "priority", label: "Priority" },
            { value: "label-add", label: "Add label" },
            { value: "label-remove", label: "Remove label" },
            { value: "estimate", label: "Estimate" },
            { value: "due-date", label: "Due date" },
          ]}
          onChange={(value) => {
            setAction(value as Action);
            setValue("");
            setClearDate(false);
            setResults([]);
          }}
        />
      </div>
      {action === "state" && (
        <div className="bulk-action-picker">
          <SingleSelect
            block
            label="Bulk Linear workflow state"
            value={value}
            disabled={busy || hasDuplicate}
            options={[
              { value: "", label: "Choose a status…" },
              ...(metadata?.states ?? []).map((state) => ({
                value: state.id,
                label: `${state.name}${state.type === "duplicate" ? " · Merge in Linear" : ""}`,
                disabled: state.type === "duplicate",
                leading: (
                  <IssueStateVisual
                    source="linear"
                    state={state.type}
                    color={state.color}
                  />
                ),
              })),
            ]}
            onChange={changeValue}
          />
        </div>
      )}
      {action === "state" && hasDuplicate && (
        <p className="property-note">
          Duplicate workflow states are managed through Linear’s merge flow.
          Choose other issues to change their state.
        </p>
      )}
      {action === "assignee" && (
        <div className="bulk-action-picker">
          <SingleSelect
            block
            label="Bulk Linear assignee"
            value={value}
            disabled={busy}
            options={[
              { value: "", label: "Choose an assignee…" },
              {
                value: "none",
                label: "Unassigned",
                empty: true,
                leading: <IssueAssigneeVisual />,
              },
              ...(metadata?.members ?? []).map((member) => ({
                value: member.id,
                label: member.name,
                leading: <IssueAssigneeVisual name={member.name} />,
              })),
            ]}
            onChange={changeValue}
          />
        </div>
      )}
      {action.startsWith("label") && (
        <div className="bulk-action-picker">
          <SingleSelect
            block
            label="Bulk Linear label"
            value={value}
            disabled={busy}
            options={[
              { value: "", label: "Choose a label…" },
              ...labels.map((label) => ({
                value: label.id,
                label: `${label.name}${label.teamId ? " · Team" : " · Workspace"}`,
                color: label.color,
              })),
            ]}
            onChange={changeValue}
          />
        </div>
      )}
      {action === "priority" && (
        <div className="bulk-action-picker">
          <SingleSelect
            block
            label="Bulk Linear priority"
            value={value}
            disabled={busy}
            options={[
              { value: "", label: "Choose priority…" },
              ...["No priority", "Urgent", "High", "Normal", "Low"].map(
                (label, priority) => ({
                  value: String(priority),
                  label,
                  empty: priority === 0,
                  leading: <IssuePriorityVisual priority={priority} />,
                }),
              ),
            ]}
            onChange={changeValue}
          />
        </div>
      )}
      {action === "estimate" && (
        <div className="bulk-action-picker">
          <SingleSelect
            block
            label="Bulk Linear estimate"
            value={value}
            disabled={busy}
            options={[
              { value: "", label: "Choose estimate…" },
              { value: "none", label: "Clear estimate", empty: true },
              ...(metadata?.estimateValues ?? []).map((estimate) => ({
                value: String(estimate),
                label: String(estimate),
              })),
            ]}
            onChange={changeValue}
          />
        </div>
      )}
      {action === "due-date" && (
        <div className="bulk-action-picker">
          <input
            aria-label="Bulk Linear due date"
            type="date"
            value={value}
            disabled={busy || clearDate}
            onChange={(event) => changeValue(event.target.value)}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={clearDate}
              disabled={busy}
              onChange={(event) => {
                setClearDate(event.target.checked);
                setResults([]);
              }}
            />
            Clear due date
          </label>
        </div>
      )}
      {ids.length > 50 && (
        <p className="inline-error" role="alert">
          Select up to 50 issues per operation.
        </p>
      )}
    </BulkActionPanel>
  );
}
