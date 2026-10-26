import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ArcoHost,
  IssueDetail,
  IssueRef,
  RepoMetadata,
} from "../shared/contracts";
import type {
  BulkUpdateResult,
  IssueCatalog,
} from "../shared/github-operations";
import { SingleSelect } from "./SingleSelect";
import {
  IssueAssigneeVisual,
  IssueLabelVisual,
  IssueStateVisual,
} from "./IssuePropertyVisual";
import { BulkActionPanel } from "./BulkActionPanel";
import { useCommandSession, useSessionState } from "./session-state";
import { useGitHubAuthScope, useGitHubCall } from "./github-auth";
import {
  bulkIssueId,
  checkBulkChange,
  isRejectedBulkCall,
  matchesBulkOperation,
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
  | "issue-type";
type Result = IssueRef & { ok: boolean; error?: string; retryable?: boolean };
const id = bulkIssueId;

export function BulkActions({
  host,
  identity,
  issues,
  onClear,
  onBusy,
}: {
  host: ArcoHost;
  identity: string;
  issues: BulkIssue[];
  onClear: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const client = useQueryClient();
  const authScope = useGitHubAuthScope();
  const call = useGitHubCall(host);
  const [unconfirmed, setUnconfirmed] = useSessionState<
    UnconfirmedBulkAttempt[]
  >(host, `github:bulk:unconfirmed:${identity}`, []);
  const sessionKey = `github:bulk:${JSON.stringify([identity, issues.map(id).sort()])}`;
  const [storedAction, setAction] = useSessionState<
    Action | "issue-field" | "project-field"
  >(host, `${sessionKey}:action`, "close");
  const action =
    storedAction === "issue-field" || storedAction === "project-field"
      ? ""
      : storedAction;
  const [value, setValue] = useSessionState(host, `${sessionKey}:value`, "");
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
  const { busy, setBusy, lock, requests } = useCommandSession(
    host,
    "github",
    authScope,
  );
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
    queryKey: ["metadata", repo, authScope],
    queryFn: () => call<RepoMetadata>("arco_repo_metadata", { repo }),
    enabled: Boolean(repo),
  });
  const catalog = useQuery({
    queryKey: ["github", "catalog", repo, first?.number, authScope],
    queryFn: () =>
      call<IssueCatalog>("arco_issue_catalog", {
        repo,
        number: first?.number,
      }),
    enabled:
      Boolean(repo && first) && ["milestone", "issue-type"].includes(action),
  });
  const requiresValue =
    action !== "" && action !== "close" && action !== "reopen";
  const catalogAction = action === "milestone" || action === "issue-type";
  const compatible = (!requiresValue || Boolean(repo)) && issues.length <= 100;
  const labelsByName = new Map<string, RepoMetadata["labels"][number]>();
  for (const label of metadata.data?.labels ?? [])
    if (!labelsByName.has(label.name)) labelsByName.set(label.name, label);
  const values = action.startsWith("label")
    ? (metadata.data?.labels.map((label) => label.name) ?? [])
    : (metadata.data?.assignees ?? []);
  const ready =
    action !== "" &&
    compatible &&
    (!requiresValue || (catalogAction ? value !== "" : values.includes(value)));
  const operation = JSON.stringify([sessionKey, action, value]);
  const matchesOperation = (attempt: BulkAttempt) =>
    matchesBulkOperation(attempt.operation, sessionKey, action, value);
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
    const input: Record<string, unknown> = { ...attempt.args };
    delete input.requestId;
    const requestKey = JSON.stringify([attempt.name, input]);
    try {
      const pending = call<BulkUpdateResult | IssueDetail>(
        attempt.name,
        attempt.args,
      );
      const dispatchedId = requests.get(requestKey);
      const response = await pending;
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
              ["issue", result.repo, result.number, authScope],
              result.issue,
            );
            next.push({ ...target, ok: true });
            continue;
          }
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
      } else {
        const issue = response as IssueDetail;
        client.setQueryData(
          ["issue", issue.repo, issue.number, authScope],
          issue,
        );
        next.push({ ...attempt.targets[0], ok: true });
      }
      if (!needsCheck.length && requests.get(requestKey) === dispatchedId)
        requests.delete(requestKey);
      if (needsCheck.length)
        rememberUnconfirmed({
          attempt,
          targets: needsCheck,
          replay: false,
          error:
            "Some update results need confirmation. Check the current issues before another update.",
        });
      if (matchesOperation(attempt)) mergeResults(next);
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
      if (matchesOperation(attempt))
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
    if (catalogAction) {
      const patch =
        action === "milestone"
          ? {
              milestoneNumber: value === "none" ? null : Number(value),
            }
          : { issueTypeId: value === "none" ? null : Number(value) };
      return {
        operation,
        targets,
        name: "arco_bulk_update",
        args: { issues: targets, requestId, patch },
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
    const current = await call<IssueDetail>("arco_get_issue", {
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
      (pending) => pending.replay && matchesOperation(pending.attempt),
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
      for (const group of catalogAction
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
            const issue = await call<IssueDetail>("arco_get_issue", {
              ...target,
            });
            client.setQueryData(
              ["issue", issue.repo, issue.number, authScope],
              issue,
            );
            const applied = await checkBulkChange(call, pending.attempt, issue);
            if (matchesOperation(pending.attempt))
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
        if (!retained.length) {
          removeUnconfirmed(pending.attempt);
          continue;
        }
        rememberUnconfirmed({
          ...pending,
          targets: retained,
          // Some targets may already have been checked and released. Do not
          // replay the original batch across those targets afterwards.
          replay: pending.replay && retained.length === pending.targets.length,
          error:
            "Could not confirm the update results. Check the connection and try again.",
        });
      }
      await refresh(issues);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <BulkActionPanel
      label="Bulk issue actions"
      count={issues.length}
      busy={busy}
      disabled={busy || !ready || hasUnconfirmed || failures.length > 0}
      onClear={onClear}
      onApply={() => void execute()}
      feedback={
        <>
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
              disabled={busy || !ready}
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
                  pending.replay && !matchesOperation(pending.attempt),
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
        </>
      }
    >
      <div className="bulk-action-picker">
        <SingleSelect
          block
          label="Bulk action"
          placeholder="Choose an action…"
          disabled={busy}
          value={action}
          onChange={(value) => {
            changeDraft();
            setAction(value as Action);
            setValue("");
          }}
          options={[
            {
              value: "label-add",
              label: "Add label",
              leading: <IssueLabelVisual />,
            },
            {
              value: "label-remove",
              label: "Remove label",
              leading: <IssueLabelVisual />,
            },
            {
              value: "assignee-add",
              label: "Add assignee",
              leading: <IssueAssigneeVisual />,
            },
            {
              value: "assignee-remove",
              label: "Remove assignee",
              leading: <IssueAssigneeVisual />,
            },
            { value: "milestone", label: "Set milestone" },
            { value: "issue-type", label: "Set issue type" },
            {
              value: "close",
              label: "Close as completed",
              leading: <IssueStateVisual source="github" state="completed" />,
            },
            {
              value: "reopen",
              label: "Reopen",
              leading: <IssueStateVisual source="github" state="open" />,
            },
          ]}
        />
      </div>
      {!compatible && (
        <p className="inline-error">
          {issues.length > 100
            ? "Select up to 100 issues per operation."
            : "Select issues from the same repository for this attribute."}
        </p>
      )}
      {requiresValue && compatible && !catalogAction && (
        <div className="bulk-action-picker">
          <SingleSelect
            block
            label="Bulk value"
            value={value}
            disabled={busy || metadata.isPending}
            onChange={(value) => {
              changeDraft();
              setValue(value);
            }}
            options={[
              {
                value: "",
                label: action.startsWith("label")
                  ? "Choose a label…"
                  : "Choose an assignee…",
              },
              ...values.map((value) => {
                const color = action.startsWith("label")
                  ? labelsByName.get(value)?.color
                  : undefined;
                return {
                  value,
                  label: value,
                  color,
                  leading: action.startsWith("label") ? (
                    <IssueLabelVisual color={color} />
                  ) : (
                    <IssueAssigneeVisual name={value} />
                  ),
                };
              }),
            ]}
          />
        </div>
      )}
      {compatible && (action === "milestone" || action === "issue-type") && (
        <div className="bulk-action-picker">
          <SingleSelect
            block
            label="Bulk attribute value"
            value={value}
            disabled={busy || catalog.isPending}
            onChange={(value) => {
              changeDraft();
              setValue(value);
            }}
            options={[
              {
                value: "",
                label:
                  action === "milestone"
                    ? "Choose a milestone…"
                    : "Choose an issue type…",
              },
              { value: "none", label: "Clear value", empty: true },
              ...(action === "milestone"
                ? (catalog.data?.milestones.map((option) => ({
                    value: String(option.number),
                    label: option.title,
                  })) ?? [])
                : (catalog.data?.issueTypes.map((option) => ({
                    value: String(option.id),
                    label: option.name,
                    color: option.color,
                  })) ?? [])),
            ]}
          />
        </div>
      )}
      {[metadata.error, catalog.error].filter(Boolean).map((failure, index) => (
        <p key={index} className="inline-error" role="alert">
          {failure?.message}
        </p>
      ))}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </BulkActionPanel>
  );
}
