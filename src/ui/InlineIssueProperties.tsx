import type { IssueDetail, RepoMetadata } from "../shared/contracts";
import type { LinearIssue, LinearMetadata } from "../shared/linear";
import { MultiSelect } from "./MultiSelect";
import { SingleSelect } from "./SingleSelect";
import { githubStatePresentation } from "./github-state";
import { linearPriorityLabels } from "./linear-priority";
import {
  IssueAssigneeVisual,
  IssueLabelVisual,
  IssuePriorityVisual,
  IssueStateVisual,
} from "./IssuePropertyVisual";

type PropertyActions = {
  metadataError?: unknown;
  busy?: boolean;
  onRetry: () => void;
  onSave: (name: string, args: Record<string, unknown>) => void;
};

function MetadataFailure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  if (!error) return null;
  return (
    <p className="inline-error inline-properties-error" role="alert">
      {error instanceof Error ? error.message : String(error)}{" "}
      <button type="button" className="text-button" onClick={onRetry}>
        Retry properties
      </button>
    </p>
  );
}

export function GitHubInlineProperties({
  issue,
  metadata,
  currentUser,
  metadataError,
  busy = false,
  onRetry,
  onSave,
}: PropertyActions & {
  issue: IssueDetail;
  metadata?: RepoMetadata;
  currentUser?: string | null;
}) {
  const ref = { repo: issue.repo, number: issue.number };
  const self = metadata?.assignees.find(
    (name) => name.toLowerCase() === currentUser?.toLowerCase(),
  );
  const assignees = [
    ...new Set([...issue.assignees, ...(metadata?.assignees ?? [])]),
  ].sort(
    (left, right) =>
      Number(right.toLowerCase() === self?.toLowerCase()) -
      Number(left.toLowerCase() === self?.toLowerCase()),
  );
  const state = githubStatePresentation(issue);
  const labels = [
    ...new Map(
      [...issue.labels, ...(metadata?.labels ?? [])].map((label) => [
        label.id,
        label,
      ]),
    ).values(),
  ];
  return (
    <>
      <div className="inline-property">
        <SingleSelect
          label="Change issue state"
          value={state.value}
          options={state.options.map((option) => ({
            ...option,
            leading: <IssueStateVisual source="github" state={option.value} />,
          }))}
          disabled={busy}
          onChange={(value) =>
            onSave("arco_update_issue", {
              ...ref,
              expectedUpdatedAt: issue.updatedAt,
              patch:
                value === "open"
                  ? { state: "open", stateReason: "reopened" }
                  : { state: "closed", stateReason: value },
            })
          }
        />
      </div>
      <div className="inline-property">
        <MultiSelect
          label="Assignees"
          compact
          value={issue.assignees}
          options={assignees.map((name) => ({
            value: name,
            label:
              name.toLowerCase() === self?.toLowerCase()
                ? `${name} (you)`
                : name,
            leading: <IssueAssigneeVisual name={name} />,
          }))}
          disabled={busy || !metadata}
          loading={!metadata && !metadataError}
          placeholder="Unassigned"
          placeholderLeading={<IssueAssigneeVisual />}
          onChange={(values) =>
            onSave("arco_update_issue", {
              ...ref,
              expectedUpdatedAt: issue.updatedAt,
              patch: { assignees: values },
            })
          }
        />
      </div>
      <div className="inline-property">
        <MultiSelect
          label="Labels"
          compact
          value={issue.labels.map((label) => label.id)}
          options={labels.map((label) => ({
            value: label.id,
            label: label.name,
            color: label.color,
            leading: <IssueLabelVisual color={label.color} />,
          }))}
          disabled={busy || !metadata}
          loading={!metadata && !metadataError}
          placeholder="No labels"
          placeholderLeading={<IssueLabelVisual />}
          onChange={(values) =>
            onSave("arco_change_labels", {
              ...ref,
              add: labels
                .filter(
                  (label) =>
                    values.includes(label.id) &&
                    !issue.labels.some((current) => current.id === label.id),
                )
                .map((label) => label.name),
              remove: issue.labels
                .filter((label) => !values.includes(label.id))
                .map((label) => label.name),
            })
          }
        />
      </div>
      <MetadataFailure error={metadataError} onRetry={onRetry} />
    </>
  );
}

export function LinearInlineProperties({
  issue,
  metadata,
  currentUserId,
  metadataError,
  busy = false,
  onRetry,
  onSave,
}: PropertyActions & {
  issue: LinearIssue;
  metadata?: LinearMetadata;
  currentUserId?: string | null;
}) {
  const ref = {
    connectionId: issue.connectionId,
    workspaceId: issue.workspaceId,
    teamId: issue.teamId,
    issueId: issue.issueId,
  };
  const self = metadata?.members.find(
    (member) => member.id === currentUserId,
  )?.id;
  const members = [
    ...new Map(
      [
        ...(issue.assignee ? [issue.assignee] : []),
        ...(metadata?.members ?? []),
      ].map((member) => [member.id, member]),
    ).values(),
  ].sort((left, right) => Number(right.id === self) - Number(left.id === self));
  const availableLabelIds = new Set(metadata?.labels.map((label) => label.id));
  const labels = [
    ...new Map(
      [...issue.labels, ...(metadata?.labels ?? [])].map((label) => [
        label.id,
        label,
      ]),
    ).values(),
  ].filter((label) => !label.isGroup);
  return (
    <>
      <div className="inline-property">
        <SingleSelect
          label="Linear Workflow state"
          value={issue.state.id}
          options={[
            ...(metadata?.states ?? []).map((state) => ({
              value: state.id,
              label: state.name,
              disabled: state.type === "duplicate",
              leading: (
                <IssueStateVisual
                  source="linear"
                  state={state.type}
                  color={state.color}
                />
              ),
            })),
            ...(!metadata?.states.some((state) => state.id === issue.state.id)
              ? [
                  {
                    value: issue.state.id,
                    label: issue.state.name,
                    disabled: true,
                    leading: (
                      <IssueStateVisual
                        source="linear"
                        state={issue.state.type}
                        color={issue.state.color}
                      />
                    ),
                  },
                ]
              : []),
          ]}
          disabled={busy || !metadata || issue.state.type === "duplicate"}
          loading={!metadata && !metadataError}
          onChange={(value) =>
            onSave("linear_update_issue", {
              ...ref,
              expectedUpdatedAt: issue.updatedAt,
              patch: { stateId: value },
            })
          }
        />
      </div>
      {issue.state.type === "duplicate" && (
        <p className="property-note">
          This issue is marked as duplicate. Manage merge and duplicate state in
          Linear.
        </p>
      )}
      <div className="inline-property">
        <SingleSelect
          label="Linear assignee"
          value={issue.assignee?.id ?? ""}
          options={[
            {
              value: "",
              label: "Unassigned",
              leading: <IssueAssigneeVisual />,
            },
            ...members.map((member) => ({
              value: member.id,
              label: member.id === self ? `${member.name} (you)` : member.name,
              leading: <IssueAssigneeVisual name={member.name} />,
            })),
          ]}
          disabled={busy || !metadata}
          loading={!metadata && !metadataError}
          onChange={(value) =>
            onSave("linear_update_issue", {
              ...ref,
              expectedUpdatedAt: issue.updatedAt,
              patch: { assigneeId: value || null },
            })
          }
        />
      </div>
      <div className="inline-property">
        <MultiSelect
          label="Labels"
          compact
          value={issue.labels.map((label) => label.id)}
          options={labels.map((label) => ({
            value: label.id,
            label: `${label.name}${label.teamId ? "" : " · workspace"}`,
            color: label.color,
            leading: <IssueLabelVisual color={label.color} />,
            disabled: !availableLabelIds.has(label.id),
          }))}
          disabled={busy || !metadata}
          loading={!metadata && !metadataError}
          placeholder="No labels"
          placeholderLeading={<IssueLabelVisual />}
          onChange={(values) =>
            onSave("linear_change_labels", {
              ...ref,
              add: values.filter(
                (value) => !issue.labels.some((label) => label.id === value),
              ),
              remove: issue.labels
                .filter((label) => !values.includes(label.id))
                .map((label) => label.id),
            })
          }
        />
      </div>
      <div className="inline-property">
        <SingleSelect
          label="Linear Priority"
          value={String(issue.priority)}
          options={linearPriorityLabels.map((label, value) => ({
            value: String(value),
            label,
            empty: value === 0,
            leading: <IssuePriorityVisual priority={value} />,
          }))}
          disabled={busy}
          onChange={(value) =>
            onSave("linear_update_issue", {
              ...ref,
              expectedUpdatedAt: issue.updatedAt,
              patch: { priority: Number(value) },
            })
          }
        />
      </div>
      <MetadataFailure error={metadataError} onRetry={onRetry} />
    </>
  );
}
