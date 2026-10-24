import type { ArcoHost } from "../shared/contracts";
import { useSessionState } from "./session-state";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { SingleSelect } from "./SingleSelect";
import type {
  LinearBulkMemberResult,
  LinearIssue,
  LinearMetadata,
  LinearScope,
} from "../shared/linear";

import { isSavedReceipt, type LinearRun } from "./linear-run";
import { DisclosureSummary } from "./DisclosureSummary";
import { useLinearIssueCache } from "./linear-queries";
type Result = LinearBulkMemberResult;
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
  metadata,
  hasDuplicate,
  busy,
  run,
  onClear,
}: {
  host: ArcoHost;
  scope: LinearScope;
  ids: string[];
  metadata?: LinearMetadata;
  hasDuplicate: boolean;
  busy: boolean;
  run: LinearRun;
  onClear: () => void;
}) {
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
    <section className="linear-bulk" aria-label="Bulk Linear actions">
      <div className="bulk-heading">
        <strong>{ids.length} selected</strong>
        <button className="text-button" disabled={busy} onClick={onClear}>
          Clear selection
        </button>
      </div>
      <details>
        <DisclosureSummary>Review target IDs</DisclosureSummary>
        <ul>
          {ids.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </details>
      <label>
        Action
        <SingleSelect
          label="Bulk Linear action"
          value={action}
          disabled={busy}
          options={[
            { value: "state", label: "Workflow state" },
            { value: "assignee", label: "Assignee" },
            { value: "label-add", label: "Add label" },
            { value: "label-remove", label: "Remove label" },
            { value: "priority", label: "Priority" },
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
      </label>
      {action === "state" && (
        <label>
          Workflow state
          <SingleSelect
            label="Bulk Linear workflow state"
            value={value}
            disabled={busy || hasDuplicate}
            options={[
              { value: "", label: "Choose a state…" },
              ...(metadata?.states ?? []).map((state) => ({
                value: state.id,
                label: `${state.name}${state.type === "duplicate" ? " · Merge in Linear" : ""}`,
                disabled: state.type === "duplicate",
              })),
            ]}
            onChange={changeValue}
          />
        </label>
      )}
      {action === "state" && hasDuplicate && (
        <p className="property-note">
          Duplicate workflow states are managed through Linear’s merge flow.
          Choose other issues to change their state.
        </p>
      )}
      {action === "assignee" && (
        <label>
          Assignee
          <SingleSelect
            label="Bulk Linear assignee"
            value={value}
            disabled={busy}
            options={[
              { value: "", label: "Choose an assignee…" },
              { value: "none", label: "Unassigned" },
              ...(metadata?.members ?? []).map((member) => ({
                value: member.id,
                label: member.name,
              })),
            ]}
            onChange={changeValue}
          />
        </label>
      )}
      {action.startsWith("label") && (
        <label>
          Existing label
          <SingleSelect
            label="Bulk Linear label"
            value={value}
            disabled={busy}
            options={[
              { value: "", label: "Choose a label…" },
              ...labels.map((label) => ({
                value: label.id,
                label: `${label.name}${label.teamId ? " · Team" : " · Workspace"}`,
              })),
            ]}
            onChange={changeValue}
          />
        </label>
      )}
      {action === "priority" && (
        <label>
          Priority
          <SingleSelect
            label="Bulk Linear priority"
            value={value}
            disabled={busy}
            options={[
              { value: "", label: "Choose priority…" },
              ...["No priority", "Urgent", "High", "Normal", "Low"].map(
                (label, priority) => ({ value: String(priority), label }),
              ),
            ]}
            onChange={changeValue}
          />
        </label>
      )}
      {action === "estimate" && (
        <label>
          Estimate
          <SingleSelect
            label="Bulk Linear estimate"
            value={value}
            disabled={busy}
            options={[
              { value: "", label: "Choose estimate…" },
              { value: "none", label: "Clear estimate" },
              ...(metadata?.estimateValues ?? []).map((estimate) => ({
                value: String(estimate),
                label: String(estimate),
              })),
            ]}
            onChange={changeValue}
          />
        </label>
      )}
      {action === "due-date" && (
        <label>
          Due date
          <input
            aria-label="Bulk Linear due date"
            type="date"
            value={value}
            disabled={busy || clearDate}
            onChange={(event) => changeValue(event.target.value)}
          />
          <span className="checkbox-label">
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
          </span>
        </label>
      )}
      {ids.length > 50 && (
        <p className="inline-error" role="alert">
          Select up to 50 issues per operation.
        </p>
      )}
      <Button
        color="secondary"
        variant="outline"
        size="sm"
        block
        disabled={
          busy ||
          refreshing ||
          !valid ||
          failures.length > 0 ||
          refreshFailures.length > 0
        }
        loading={busy}
        onClick={() => void execute()}
      >
        Apply to {ids.length} issues
      </Button>
      {refreshFailures.length > 0 && (
        <div>
          <ul
            className="bulk-refresh-results"
            aria-label="Saved issues requiring refresh"
            aria-live="polite"
          >
            {refreshFailures.map((result) => (
              <li key={result.issueId}>
                {result.issueId}: {result.refreshError}
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
              {result.issueId}: {result.error}
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
    </section>
  );
}
