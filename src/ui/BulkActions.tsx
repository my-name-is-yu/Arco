import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type {
  ArcoHost,
  Connection,
  IssueDetail,
  IssueRef,
  RepoMetadata,
} from "../shared/contracts";
import type {
  BulkUpdateResult,
  FieldValue,
  IssueCatalog,
  IssueFieldList,
  ProjectFieldList,
  IssueProjectMemberships,
} from "../shared/github-operations";
import { FieldEditor } from "./GitHubProperties";
import { SingleSelect } from "./SingleSelect";
import { DisclosureSummary } from "./DisclosureSummary";
import { useCommandSession, useSessionState } from "./session-state";

export interface BulkIssue extends IssueRef {
  title: string;
}
type Action =
  | "close"
  | "reopen"
  | "label-add"
  | "label-remove"
  | "assignee-add"
  | "assignee-remove"
  | "milestone"
  | "issue-type"
  | "issue-field"
  | "project-field";
type Result = IssueRef & { ok: boolean; error?: string };
const id = (issue: IssueRef) => `${issue.repo}#${issue.number}`;

export function BulkActions({
  host,
  issues,
  onClear,
  onBusy,
}: {
  host: ArcoHost;
  issues: BulkIssue[];
  onClear: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const connection = client.getQueryData<Connection>(["connection"]);
  const identity = `${connection?.mode ?? "pending"}:${connection?.account ?? "disconnected"}`;
  const sessionKey = `github:bulk:${JSON.stringify([identity, issues.map(id).sort()])}`;
  const [action, setAction] = useSessionState<Action>(
    host,
    `${sessionKey}:action`,
    "close",
  );
  const [value, setValue] = useSessionState(host, `${sessionKey}:value`, "");
  const [fieldId, setFieldId] = useSessionState(
    host,
    `${sessionKey}:fieldId`,
    "",
  );
  const [projectId, setProjectId] = useSessionState(
    host,
    `${sessionKey}:projectId`,
    "",
  );
  const [fieldValue, setFieldValue] = useSessionState<FieldValue>(
    host,
    `${sessionKey}:fieldValue`,
    null,
  );
  const [fieldReady, setFieldReady] = useSessionState(
    host,
    `${sessionKey}:fieldReady`,
    false,
  );
  const [results, setResults] = useSessionState<Result[]>(
    host,
    `${sessionKey}:results`,
    [],
  );
  const failures = results.filter((result) => !result.ok);
  const [error, setError] = useSessionState(host, `${sessionKey}:error`, "");
  const {
    busy,
    setBusy,
    lock,
    requests: retryIds,
  } = useCommandSession(host, "github");
  const repos = [...new Set(issues.map((issue) => issue.repo))];
  const repo = repos.length === 1 ? repos[0] : undefined;
  const first = issues[0];
  const metadata = useQuery({
    queryKey: ["metadata", repo],
    queryFn: () => host.call<RepoMetadata>("arco_repo_metadata", { repo }),
    enabled: Boolean(repo),
  });
  const catalog = useQuery({
    queryKey: ["github", "catalog", repo, first?.number],
    queryFn: () =>
      host.call<IssueCatalog>("arco_issue_catalog", {
        repo,
        number: first?.number,
      }),
    enabled:
      Boolean(repo && first) && ["milestone", "issue-type"].includes(action),
  });
  const issueFields = useQuery({
    queryKey: ["github", "issue-fields", repo, first?.number],
    queryFn: () =>
      host.call<IssueFieldList>("arco_issue_fields", {
        repo,
        number: first?.number,
      }),
    enabled: Boolean(repo && first) && action === "issue-field",
  });
  const memberships = useQuery({
    queryKey: ["github", "memberships", repo, first?.number],
    queryFn: () =>
      host.call<IssueProjectMemberships>("arco_issue_projects", {
        repo,
        number: first?.number,
      }),
    enabled: Boolean(repo && first) && action === "project-field",
  });
  const member = memberships.data?.memberships.find(
    (member) => member.projectId === projectId,
  );
  const projectFields = useQuery({
    queryKey: [
      "github",
      "project-fields",
      repo,
      first?.number,
      projectId,
      member?.itemId,
    ],
    queryFn: () =>
      host.call<ProjectFieldList>("arco_project_fields", {
        repo,
        number: first?.number,
        projectId,
        itemId: member?.itemId,
      }),
    enabled: Boolean(repo && first && member) && action === "project-field",
  });
  const requiresValue = action !== "close" && action !== "reopen";
  const advanced = [
    "milestone",
    "issue-type",
    "issue-field",
    "project-field",
  ].includes(action);
  const fieldAction = action === "issue-field" || action === "project-field";
  const compatible = (!requiresValue || Boolean(repo)) && issues.length <= 100;
  const values = action.startsWith("label")
    ? (metadata.data?.labels.map((label) => label.name) ?? [])
    : (metadata.data?.assignees ?? []);
  const fields =
    action === "issue-field"
      ? (issueFields.data?.fields ?? [])
      : (projectFields.data?.fields ?? []);
  const field = fields.find(
    (field) => String(field.id) === fieldId && field.supported,
  );
  const ready =
    compatible &&
    (!requiresValue ||
      (fieldAction
        ? Boolean(field && fieldReady)
        : advanced
          ? value !== ""
          : values.includes(value)));
  const execute = async (onlyFailed = false) => {
    if (lock.current || !issues.length || !ready) return;
    const targets = onlyFailed
      ? issues.filter((issue) =>
          results.some((result) => !result.ok && id(result) === id(issue)),
        )
      : [...issues];
    if (!targets.length) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setResults([]);
    setError("");
    try {
      if (advanced) {
        const patch =
          action === "milestone"
            ? {
                patch: {
                  milestoneNumber: value === "none" ? null : Number(value),
                },
              }
            : action === "issue-type"
              ? {
                  patch: {
                    issueTypeId: value === "none" ? null : Number(value),
                  },
                }
              : action === "issue-field"
                ? {
                    issueField: { fieldId: Number(fieldId), value: fieldValue },
                  }
                : { projectField: { projectId, fieldId, value: fieldValue } };
        const operation = JSON.stringify([
          "bulk",
          identity,
          targets.map((issue) => ({ repo: issue.repo, number: issue.number })),
          patch,
        ]);
        const requestId = retryIds.get(operation) ?? crypto.randomUUID();
        retryIds.set(operation, requestId);
        const result = await host.call<BulkUpdateResult>("arco_bulk_update", {
          issues: targets.map((issue) => ({
            repo: issue.repo,
            number: issue.number,
          })),
          requestId,
          ...patch,
        });
        retryIds.delete(operation);
        setResults(result.results);
        await Promise.all(
          targets.map((issue) =>
            client.invalidateQueries({
              queryKey: ["issue", issue.repo, issue.number],
            }),
          ),
        );
      } else
        for (const issue of targets) {
          const operation = JSON.stringify([
            "bulk",
            identity,
            id(issue),
            action,
            value,
          ]);
          const requestId = retryIds.get(operation) ?? crypto.randomUUID();
          retryIds.set(operation, requestId);
          try {
            if (action.startsWith("label"))
              await host.call<IssueDetail>("arco_change_labels", {
                repo: issue.repo,
                number: issue.number,
                requestId,
                add: action === "label-add" ? [value] : [],
                remove: action === "label-remove" ? [value] : [],
              });
            else {
              const current = await host.call<IssueDetail>("arco_get_issue", {
                repo: issue.repo,
                number: issue.number,
              });
              const patch =
                action === "close"
                  ? { state: "closed", stateReason: "completed" }
                  : action === "reopen"
                    ? { state: "open", stateReason: "reopened" }
                    : {
                        assignees:
                          action === "assignee-add"
                            ? [...new Set([...current.assignees, value])]
                            : current.assignees.filter(
                                (name) => name !== value,
                              ),
                      };
              await host.call<IssueDetail>("arco_update_issue", {
                repo: issue.repo,
                number: issue.number,
                requestId,
                expectedUpdatedAt: current.updatedAt,
                patch,
              });
            }
            retryIds.delete(operation);
            await client.invalidateQueries({
              queryKey: ["issue", issue.repo, issue.number],
            });
            setResults((previous) => [
              ...previous,
              { repo: issue.repo, number: issue.number, ok: true },
            ]);
          } catch (error) {
            setResults((previous) => [
              ...previous,
              {
                repo: issue.repo,
                number: issue.number,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              },
            ]);
          }
        }
      await Promise.all([
        client.invalidateQueries({ queryKey: ["issues"] }),
        client.invalidateQueries({ queryKey: ["github"] }),
      ]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <section className="bulk-actions" aria-label="Bulk issue actions">
      <div className="bulk-heading">
        <strong>{issues.length} selected</strong>
        <button className="text-button" disabled={busy} onClick={onClear}>
          Clear selection
        </button>
      </div>
      <details>
        <DisclosureSummary>Review targets</DisclosureSummary>
        <ul>
          {issues.map((issue) => (
            <li key={id(issue)}>
              {issue.repo} #{issue.number} · {issue.title}
            </li>
          ))}
        </ul>
      </details>
      <label>
        Bulk action
        <SingleSelect
          label="Bulk action"
          disabled={busy}
          value={action}
          onChange={(value) => {
            setAction(value as Action);
            setValue("");
            setFieldId("");
            setProjectId("");
            setFieldReady(false);
            setResults([]);
          }}
          options={[
            { value: "close", label: "Close · Completed" },
            { value: "reopen", label: "Reopen" },
            { value: "label-add", label: "Add label" },
            { value: "label-remove", label: "Remove label" },
            { value: "assignee-add", label: "Add assignee" },
            { value: "assignee-remove", label: "Remove assignee" },
            { value: "milestone", label: "Set milestone" },
            { value: "issue-type", label: "Set issue type" },
            { value: "issue-field", label: "Set Issue field" },
            { value: "project-field", label: "Set Project field" },
          ]}
        />
      </label>
      {!compatible && (
        <p className="inline-error">
          {issues.length > 100
            ? "Select up to 100 issues per operation."
            : "Select issues from the same repository for this attribute."}
        </p>
      )}
      {requiresValue && compatible && !advanced && (
        <label>
          {action.startsWith("label") ? "Labels" : "Assignees"}
          <SingleSelect
            label="Bulk value"
            value={value}
            disabled={busy || metadata.isPending}
            onChange={setValue}
            options={[
              { value: "", label: "Choose a value…" },
              ...values.map((value) => ({ value, label: value })),
            ]}
          />
        </label>
      )}
      {compatible && (action === "milestone" || action === "issue-type") && (
        <label>
          {action === "milestone" ? "Milestone" : "Issue type"}
          <SingleSelect
            label="Bulk attribute value"
            value={value}
            disabled={busy || catalog.isPending}
            onChange={setValue}
            options={[
              { value: "", label: "Choose a value…" },
              { value: "none", label: "Clear value" },
              ...(action === "milestone"
                ? (catalog.data?.milestones.map((option) => ({
                    value: String(option.number),
                    label: option.title,
                  })) ?? [])
                : (catalog.data?.issueTypes.map((option) => ({
                    value: String(option.id),
                    label: option.name,
                  })) ?? [])),
            ]}
          />
        </label>
      )}
      {compatible && action === "project-field" && (
        <>
          <label>
            Shared Project
            <SingleSelect
              label="Bulk Project"
              value={projectId}
              disabled={busy || memberships.isPending}
              onChange={(value) => {
                setProjectId(value);
                setFieldId("");
                setFieldReady(false);
              }}
              options={[
                { value: "", label: "Choose a Project…" },
                ...(memberships.data?.memberships.map((member) => ({
                  value: member.projectId,
                  label: member.title,
                })) ?? []),
              ]}
            />
          </label>
          <p className="property-note">
            Select a Project containing every target. Issues outside it remain
            unchanged and report a failure.
          </p>
        </>
      )}
      {compatible && fieldAction && (
        <>
          <label>
            Existing field
            <SingleSelect
              label="Bulk field"
              value={fieldId}
              disabled={busy}
              onChange={(value) => {
                setFieldId(value);
                setFieldReady(false);
                setFieldValue(null);
              }}
              options={[
                { value: "", label: "Choose a field…" },
                ...fields
                  .filter((field) => field.supported)
                  .map((field) => ({
                    value: String(field.id),
                    label: `${field.name} · ${field.type}`,
                  })),
              ]}
            />
          </label>
          {field && (
            <FieldEditor
              key={`${action}:${field.id}`}
              host={host}
              draftScope={[sessionKey, action, projectId, field.id]}
              field={{ ...field, value: fieldValue }}
              kind={action === "issue-field" ? "issue" : "project"}
              busy={busy}
              saveLabel="Prepare value"
              onSave={async (value) => {
                setFieldValue(value);
                setFieldReady(true);
                return true;
              }}
            />
          )}
          {field && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setFieldValue(null);
                setFieldReady(true);
              }}
            >
              Clear the field value
            </button>
          )}
          {fieldReady && (
            <p className="property-note">
              Value to apply:{" "}
              {fieldValue === null
                ? "Clear value"
                : Array.isArray(fieldValue)
                  ? fieldValue.join(", ")
                  : String(fieldValue)}
            </p>
          )}
        </>
      )}
      {[
        metadata.error,
        catalog.error,
        issueFields.error,
        memberships.error,
        projectFields.error,
      ]
        .filter(Boolean)
        .map((failure, index) => (
          <p key={index} className="inline-error" role="alert">
            {failure?.message}
          </p>
        ))}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <Button
        color="secondary"
        variant="outline"
        size="sm"
        block
        disabled={busy || !ready}
        loading={busy}
        onClick={() => void execute()}
      >
        {busy ? "Refreshing…" : `Apply to ${issues.length} issues`}
      </Button>
      {failures.length > 0 && (
        <ul
          className="bulk-results"
          aria-label="Failed issues"
          aria-live="polite"
        >
          {failures.map((result) => (
            <li className="inline-error" key={id(result)}>
              <strong>
                {result.repo} #{result.number}
              </strong>{" "}
              {result.error}
            </li>
          ))}
        </ul>
      )}
      {failures.length > 0 && (
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
