import { useEffect } from "react";
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
import {
  bulkIssueId,
  checkBulkChange,
  isRejectedBulkCall,
  type BulkAttempt,
  type UnconfirmedBulkAttempt,
} from "./github-bulk-recovery";

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
type Result = IssueRef & { ok: boolean; error?: string; retryable?: boolean };
const id = bulkIssueId;

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
  const [unconfirmed, setUnconfirmed] = useSessionState<
    UnconfirmedBulkAttempt[]
  >(host, `github:bulk:unconfirmed:${identity}`, []);
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
  const relevantUnconfirmed = unconfirmed.filter((pending) =>
    pending.targets.some((target) =>
      issues.some((issue) => id(issue) === id(target)),
    ),
  );
  const hasUnconfirmed = relevantUnconfirmed.length > 0;
  const retryableFailures = failures.filter(
    (result) =>
      result.retryable &&
      !relevantUnconfirmed.some(
        (pending) =>
          !pending.replay &&
          pending.targets.some((target) => id(target) === id(result)),
      ),
  );
  const [error, setError] = useSessionState(host, `${sessionKey}:error`, "");
  const { busy, setBusy, lock } = useCommandSession(host, "github");
  useEffect(() => {
    if (
      !busy &&
      !error &&
      !hasUnconfirmed &&
      issues.length > 0 &&
      issues.every((issue) =>
        results.some((result) => id(result) === id(issue) && result.ok),
      )
    ) {
      setResults([]);
      onClear();
    }
  }, [busy, error, hasUnconfirmed, issues, results, setResults, onClear]);
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
  const operation = JSON.stringify([
    sessionKey,
    action,
    value,
    fieldId,
    projectId,
    fieldValue,
    fieldReady,
  ]);
  const changeDraft = () => {
    setResults([]);
    setError("");
  };
  const mergeResults = (next: Result[]) => {
    setResults((previous) => [
      ...previous.filter(
        (old) => !next.some((result) => id(result) === id(old)),
      ),
      ...next,
    ]);
  };
  const removeUnconfirmed = (attempt: BulkAttempt) => {
    setUnconfirmed((previous) =>
      previous.filter(
        (pending) => pending.attempt.args.requestId !== attempt.args.requestId,
      ),
    );
  };
  const rememberUnconfirmed = (pending: UnconfirmedBulkAttempt) => {
    setUnconfirmed((previous) => [
      ...previous.filter(
        (old) => old.attempt.args.requestId !== pending.attempt.args.requestId,
      ),
      pending,
    ]);
  };
  const refresh = async (targets: IssueRef[]) => {
    await Promise.all([
      ...targets.map((issue) =>
        client.invalidateQueries({
          queryKey: ["issue", issue.repo, issue.number],
        }),
      ),
      client.invalidateQueries({ queryKey: ["issues"] }),
      client.invalidateQueries({ queryKey: ["github"] }),
      client.invalidateQueries({ queryKey: ["issue-set"] }),
    ]);
  };
  const applyAttempt = async (attempt: BulkAttempt) => {
    try {
      const response = await host.call<BulkUpdateResult | IssueDetail>(
        attempt.name,
        attempt.args,
      );
      removeUnconfirmed(attempt);
      const next: Result[] = [];
      const needsCheck: IssueRef[] = [];
      if (attempt.name === "arco_bulk_update") {
        const responseResults = (response as BulkUpdateResult).results;
        for (const target of attempt.targets) {
          const result = responseResults.find(
            (result) => id(result) === id(target),
          );
          if (result?.ok) {
            client.setQueryData(
              ["issue", result.repo, result.number],
              result.issue,
            );
            next.push({ ...target, ok: true });
          } else {
            const retryable = result?.needsConfirmation === false;
            next.push({
              ...target,
              ok: false,
              retryable,
              error:
                result?.error ??
                "The update result was not returned. Check the issue before trying again.",
            });
            if (!retryable) needsCheck.push(target);
          }
        }
      } else {
        const issue = response as IssueDetail;
        client.setQueryData(["issue", issue.repo, issue.number], issue);
        next.push({ ...attempt.targets[0], ok: true });
      }
      if (needsCheck.length)
        rememberUnconfirmed({
          attempt,
          targets: needsCheck,
          replay: false,
          error:
            "Some update results need confirmation. Check the current issues before another update.",
        });
      if (attempt.operation === operation) mergeResults(next);
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : String(failure);
      if (isRejectedBulkCall(failure)) removeUnconfirmed(attempt);
      else
        rememberUnconfirmed({
          attempt,
          targets: attempt.targets,
          replay: true,
          error: message,
        });
      if (attempt.operation === operation)
        mergeResults(
          attempt.targets.map((target) => ({
            ...target,
            ok: false,
            retryable: true,
            error: message,
          })),
        );
    }
  };
  const buildAttempt = async (targets: IssueRef[]): Promise<BulkAttempt> => {
    const requestId = crypto.randomUUID();
    if (advanced) {
      const change =
        action === "milestone"
          ? {
              patch: {
                milestoneNumber: value === "none" ? null : Number(value),
              },
            }
          : action === "issue-type"
            ? {
                patch: { issueTypeId: value === "none" ? null : Number(value) },
              }
            : action === "issue-field"
              ? { issueField: { fieldId: Number(fieldId), value: fieldValue } }
              : { projectField: { projectId, fieldId, value: fieldValue } };
      return {
        operation,
        targets,
        name: "arco_bulk_update",
        args: { issues: targets, requestId, ...change },
      };
    }
    const issue = targets[0];
    if (action.startsWith("label"))
      return {
        operation,
        targets,
        name: "arco_change_labels",
        args: {
          ...issue,
          requestId,
          add: action === "label-add" ? [value] : [],
          remove: action === "label-remove" ? [value] : [],
        },
      };
    const current = await host.call<IssueDetail>("arco_get_issue", {
      ...issue,
    });
    const patch =
      action === "close"
        ? { state: "closed" as const, stateReason: "completed" as const }
        : action === "reopen"
          ? { state: "open" as const, stateReason: "reopened" as const }
          : {
              assignees:
                action === "assignee-add"
                  ? [...new Set([...current.assignees, value])]
                  : current.assignees.filter((name) => name !== value),
            };
    return {
      operation,
      targets,
      name: "arco_update_issue",
      args: {
        ...issue,
        requestId,
        expectedUpdatedAt: current.updatedAt,
        patch,
      },
    };
  };
  const execute = async (onlyFailed = false) => {
    if (
      lock.current ||
      !issues.length ||
      !ready ||
      (!onlyFailed && hasUnconfirmed)
    )
      return;
    const pending = relevantUnconfirmed.filter(
      (pending) => pending.replay && pending.attempt.operation === operation,
    );
    const pendingIds = new Set(
      relevantUnconfirmed.flatMap((pending) => pending.targets.map(id)),
    );
    const targets = issues.filter(
      (issue) =>
        !pendingIds.has(id(issue)) &&
        (!onlyFailed ||
          results.some(
            (result) =>
              id(result) === id(issue) && !result.ok && result.retryable,
          )),
    );
    if (!targets.length && !pending.length) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    if (!onlyFailed) setResults([]);
    setError("");
    try {
      for (const recovery of pending) await applyAttempt(recovery.attempt);
      for (const group of advanced
        ? targets.length
          ? [targets]
          : []
        : targets.map((target) => [target])) {
        try {
          await applyAttempt(
            await buildAttempt(
              group.map(({ repo, number }) => ({ repo, number })),
            ),
          );
        } catch (failure) {
          // Building an attempt only reads; no mutation has been submitted yet.
          mergeResults(
            group.map((target) => ({
              ...target,
              ok: false,
              retryable: true,
              error:
                failure instanceof Error ? failure.message : String(failure),
            })),
          );
        }
      }
      await refresh(issues);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  const recover = async (check: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    try {
      for (const pending of relevantUnconfirmed) {
        if (!check) {
          if (pending.replay) await applyAttempt(pending.attempt);
          continue;
        }
        const retained: IssueRef[] = [];
        for (const target of pending.targets) {
          try {
            const issue = await host.call<IssueDetail>("arco_get_issue", {
              ...target,
            });
            client.setQueryData(["issue", issue.repo, issue.number], issue);
            const applied = await checkBulkChange(host, pending.attempt, issue);
            if (pending.attempt.operation === operation)
              mergeResults([
                {
                  ...target,
                  ok: applied,
                  retryable: !applied,
                  ...(!applied
                    ? {
                        error:
                          "The current state differs from the requested change. Review it, then explicitly retry if needed.",
                      }
                    : {}),
                },
              ]);
          } catch {
            retained.push(target);
          }
        }
        if (retained.length)
          rememberUnconfirmed({
            ...pending,
            targets: retained,
            // Some targets may already have been checked and released. Do not
            // replay the original batch across those targets afterwards.
            replay:
              pending.replay && retained.length === pending.targets.length,
            error:
              "Could not confirm the update results. Check the connection and try again.",
          });
        else removeUnconfirmed(pending.attempt);
      }
      await refresh(issues);
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
            changeDraft();
            setAction(value as Action);
            setValue("");
            setFieldId("");
            setProjectId("");
            setFieldReady(false);
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
            onChange={(value) => {
              changeDraft();
              setValue(value);
            }}
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
            onChange={(value) => {
              changeDraft();
              setValue(value);
            }}
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
                changeDraft();
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
                changeDraft();
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
                changeDraft();
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
                changeDraft();
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
        color="primary"
        size="sm"
        block
        disabled={busy || !ready || hasUnconfirmed || failures.length > 0}
        loading={busy}
        onClick={() => void execute()}
      >
        {busy ? "Applying…" : `Apply to ${issues.length} issues`}
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
      {retryableFailures.length > 0 && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void execute(true)}
        >
          Retry failed issues only
        </button>
      )}
      {hasUnconfirmed && (
        <div className="bulk-unconfirmed" role="status">
          <p>Previous changes need confirmation before another update.</p>
          <ul aria-label="Unconfirmed changes">
            {relevantUnconfirmed.map((pending) => (
              <li key={pending.attempt.args.requestId}>
                {pending.targets
                  .map((target) => `${target.repo} #${target.number}`)
                  .join(", ")}
                : {pending.error}
              </li>
            ))}
          </ul>
          {relevantUnconfirmed.some(
            (pending) =>
              pending.replay && pending.attempt.operation !== operation,
          ) && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void recover(false)}
            >
              Retry unconfirmed changes
            </button>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void recover(true)}
          >
            Check current state
          </button>
        </div>
      )}
    </section>
  );
}
