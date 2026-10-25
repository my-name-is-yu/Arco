import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { ArcoHost } from "../shared/contracts";
import type { LinearIssue, LinearMetadata } from "../shared/linear";
import { SingleSelect } from "./SingleSelect";
import { DisclosureSummary } from "./DisclosureSummary";
import { useSessionState } from "./session-state";
import { isSavedReceipt, type LinearRun } from "./linear-run";
const emptyLabelDraft = {
  id: "",
  name: "",
  color: "#8b8b8b",
  description: "",
  scope: "team",
};
export function LinearLabelManager({
  host,
  issue,
  metadata,
  busy,
  run,
}: {
  host: ArcoHost;
  issue: LinearIssue;
  metadata?: LinearMetadata;
  busy: boolean;
  run: LinearRun;
}) {
  const [labelDraft, setLabelDraft] = useSessionState(
    host,
    `linear:label-definition:${issue.connectionId}:${issue.workspaceId}:${issue.teamId}:${issue.issueId}`,
    emptyLabelDraft,
  );
  const labels = metadata?.labels.filter((label) => !label.isGroup) ?? [];
  return (
    <details className="linear-extra">
      <DisclosureSummary>Manage label definitions</DisclosureSummary>
      <p className="muted">
        Definitions apply across Issues. Manage label groups and scope changes
        in Linear.
      </p>
      <label>
        Definition
        <SingleSelect
          label="Linear label definition"
          value={labelDraft.id}
          disabled={busy}
          options={[
            { value: "", label: "New label" },
            ...labels.map((label) => ({
              value: label.id,
              label: `${label.name} · ${label.teamId ? "team" : "workspace"}`,
              color: label.color,
            })),
            ...(labelDraft.id &&
            !labels.some((label) => label.id === labelDraft.id)
              ? [
                  {
                    value: labelDraft.id,
                    label: labelDraft.name || "Unavailable label",
                    color: labelDraft.color,
                    disabled: true,
                  },
                ]
              : []),
          ]}
          onChange={(value) => {
            const label = metadata?.labels.find((item) => item.id === value);
            setLabelDraft(
              label
                ? {
                    id: label.id,
                    name: label.name,
                    color: label.color,
                    description: label.description ?? "",
                    scope: label.teamId ? "team" : "workspace",
                  }
                : emptyLabelDraft,
            );
          }}
        />
      </label>
      <label>
        Name
        <input
          value={labelDraft.name}
          disabled={busy}
          onChange={(event) =>
            setLabelDraft((previous) => ({
              ...previous,
              name: event.target.value,
            }))
          }
        />
      </label>
      <label>
        Color
        <input
          type="color"
          value={labelDraft.color}
          disabled={busy}
          onChange={(event) =>
            setLabelDraft((previous) => ({
              ...previous,
              color: event.target.value,
            }))
          }
        />
      </label>
      <label>
        Description
        <input
          value={labelDraft.description}
          disabled={busy}
          onChange={(event) =>
            setLabelDraft((previous) => ({
              ...previous,
              description: event.target.value,
            }))
          }
        />
      </label>
      {!labelDraft.id && (
        <label>
          Scope
          <SingleSelect
            label="Linear label scope"
            value={labelDraft.scope}
            disabled={busy}
            options={[
              { value: "team", label: "This team" },
              { value: "workspace", label: "workspace" },
            ]}
            onChange={(value) =>
              setLabelDraft((previous) => ({
                ...previous,
                scope: value,
              }))
            }
          />
        </label>
      )}
      <Button
        color="secondary"
        variant="outline"
        size="sm"
        disabled={busy || !labelDraft.name.trim()}
        onClick={() =>
          void run<LinearMetadata>("linear_label_definition", {
            connectionId: issue.connectionId,
            workspaceId: issue.workspaceId,
            teamId: issue.teamId,
            action: labelDraft.id ? "update" : "create",
            ...(labelDraft.id ? { labelId: labelDraft.id } : {}),
            name: labelDraft.name,
            color: labelDraft.color,
            description: labelDraft.description,
            scope: labelDraft.scope,
          }).then((result) => {
            if (!labelDraft.id && result && !isSavedReceipt(result))
              setLabelDraft(emptyLabelDraft);
          })
        }
      >
        {labelDraft.id ? "Save" : "Create label"}
      </Button>
      {labelDraft.id && (
        <details>
          <DisclosureSummary>Delete definition</DisclosureSummary>
          <p>
            Delete “{labelDraft.name}” from this {labelDraft.scope}. Issues will
            lose this label when its definition is deleted.
          </p>
          <Button
            color="danger"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run<LinearMetadata>("linear_label_definition", {
                connectionId: issue.connectionId,
                workspaceId: issue.workspaceId,
                teamId: issue.teamId,
                action: "delete",
                labelId: labelDraft.id,
                scope: labelDraft.scope,
              }).then((result) => {
                if (result && !isSavedReceipt(result))
                  setLabelDraft(emptyLabelDraft);
              })
            }
          >
            Delete this label definition
          </Button>
        </details>
      )}
    </details>
  );
}
