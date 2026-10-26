import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { ArcoHost } from "../shared/contracts";
import type {
  GitHubOperationResult,
  LabelDefinition,
} from "../shared/github-operations";
import { useGitHubOperation } from "./useGitHubOperation";
import { DisclosureSummary } from "./DisclosureSummary";
import { useGitHubAuthScope, useGitHubCall } from "./github-auth";

export function LabelManager({ host, repo }: { host: ArcoHost; repo: string }) {
  const authScope = useGitHubAuthScope();
  const call = useGitHubCall(host);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LabelDefinition | null>(null);
  const [form, setForm] = useState({
    name: "",
    color: "808080",
    description: "",
  });
  const [deleting, setDeleting] = useState<LabelDefinition | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const labels = useQuery({
    queryKey: ["github", "label-definitions", repo, authScope],
    queryFn: () =>
      call<{ repo: string; labels: LabelDefinition[] }>(
        "arco_label_definitions",
        { repo },
      ),
    enabled: open,
  });
  const action = useGitHubOperation(host, ["label-definitions", repo]);
  const reset = () => {
    setEditing(null);
    setForm({ name: "", color: "808080", description: "" });
  };
  return (
    <details
      className="advanced-section label-manager"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <DisclosureSummary>Manage label definitions</DisclosureSummary>
      <p className="property-note">
        Repository: {repo}. Changing repository definitions is separate from
        adding or removing issue labels.
      </p>
      {labels.isPending && <p className="muted">Loading labels…</p>}
      {labels.isError && (
        <p className="inline-error" role="alert">
          {labels.error.message}
        </p>
      )}
      <ul className="definition-list">
        {labels.data?.labels.map((label) => (
          <li key={label.id}>
            <span
              className="label-dot"
              style={{ backgroundColor: `#${label.color}` }}
            />
            <span>
              <strong>{label.name}</strong>
              <small>{label.description}</small>
            </span>
            <button
              className="text-button"
              disabled={action.busy}
              onClick={() => {
                setEditing(label);
                setForm({
                  name: label.name,
                  color: label.color,
                  description: label.description,
                });
                setDeleting(null);
              }}
            >
              Edit
            </button>
            <button
              className="text-button"
              disabled={action.busy}
              onClick={() => {
                setDeleting(label);
                setConfirmation("");
              }}
            >
              Delete definition
            </button>
          </li>
        ))}
      </ul>
      {deleting && (
        <div className="delete-confirm">
          <strong>Delete label definition “{deleting.name}”</strong>
          <p>
            This removes the label from every issue in {repo}. Enter the label
            name to confirm.
          </p>
          <input
            aria-label="Confirm label name to delete"
            value={confirmation}
            disabled={action.busy}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <Button
            color="danger"
            variant="outline"
            size="sm"
            disabled={action.busy || confirmation !== deleting.name}
            onClick={() =>
              void action.run<GitHubOperationResult>(
                "arco_delete_label",
                { repo, name: deleting.name },
                () => {
                  setDeleting(null);
                  reset();
                },
              )
            }
          >
            Delete repository label definition
          </Button>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() => setDeleting(null)}
          >
            Cancel
          </button>
        </div>
      )}
      <form
        className="compact-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run<GitHubOperationResult>(
            editing ? "arco_update_label" : "arco_create_label",
            editing
              ? { repo, name: editing.name, patch: form }
              : { repo, ...form },
            reset,
          );
        }}
      >
        <h3>
          {editing ? `Edit “${editing.name}”` : "Create label definition"}
        </h3>
        <label>
          Name
          <input
            required
            maxLength={100}
            disabled={action.busy}
            value={form.name}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, name: event.target.value }))
            }
          />
        </label>
        <label>
          Color (6-digit hex)
          <input
            required
            pattern="[a-fA-F0-9]{6}"
            maxLength={6}
            disabled={action.busy}
            value={form.color}
            onChange={(event) =>
              setForm((previous) => ({
                ...previous,
                color: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Description
          <input
            maxLength={100}
            disabled={action.busy}
            value={form.description}
            onChange={(event) =>
              setForm((previous) => ({
                ...previous,
                description: event.target.value,
              }))
            }
          />
        </label>
        <div className="editor-actions">
          {editing && (
            <button
              className="text-button"
              type="button"
              disabled={action.busy}
              onClick={reset}
            >
              Create a new definition
            </button>
          )}
          <Button
            color="primary"
            size="sm"
            type="submit"
            disabled={
              action.busy ||
              !form.name.trim() ||
              !/^[a-fA-F0-9]{6}$/.test(form.color)
            }
          >
            {editing ? "Save changes" : "Create label"}
          </Button>
        </div>
      </form>
      {action.error && (
        <p className="inline-error" role="alert">
          {action.error}
        </p>
      )}
    </details>
  );
}
