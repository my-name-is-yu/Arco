import type { ArcoHost } from "../shared/contracts";
import { useSessionState } from "./session-state";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { SingleSelect } from "./SingleSelect";
import type { LinearMetadata, LinearScope } from "../shared/linear";

import { isSavedReceipt, type LinearRun } from "./linear-run";
import { DisclosureSummary } from "./DisclosureSummary";
type Result = { issueId: string; success: boolean; error?: string };
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
    if (!valid || busy) return;
    const targets = failedOnly
      ? ids.filter((id) =>
          results.some((result) => result.issueId === id && !result.success),
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
    if (result && !isSavedReceipt(result)) setResults(result.results);
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
            onChange={setValue}
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
            onChange={setValue}
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
            onChange={setValue}
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
            onChange={setValue}
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
            onChange={setValue}
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
            onChange={(event) => setValue(event.target.value)}
          />
          <span className="checkbox-label">
            <input
              type="checkbox"
              checked={clearDate}
              disabled={busy}
              onChange={(event) => setClearDate(event.target.checked)}
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
        disabled={busy || !valid}
        loading={busy}
        onClick={() => void execute()}
      >
        Apply to {ids.length} issues
      </Button>
      {results.length > 0 && (
        <ul className="bulk-results" aria-live="polite">
          {results.map((result) => (
            <li
              key={result.issueId}
              className={result.success ? "operation-saved" : "inline-error"}
            >
              {result.issueId}:{" "}
              {result.success ? "Saved and refreshed" : result.error}
            </li>
          ))}
        </ul>
      )}
      {results.some((result) => !result.success) && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void execute(true)}
        >
          Retry failed issues only
        </button>
      )}
    </section>
  );
}
