import { Notice, type NoticeValue } from "./Notice";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { ArcoHost } from "../shared/contracts";
import type { Draft, DraftKey } from "../shared/state";
import type {
  LinearIssue,
  LinearScope,
  LinearMetadata,
  LinearTemplate,
  LinearSavedReceipt,
} from "../shared/linear";
import {
  DraftStatus,
  draftStorageId,
  useDraftPersistence,
} from "./useDraftPersistence";
import { SingleSelect } from "./SingleSelect";
import { CreateDialog } from "./CreateDialog";
import { DisclosureSummary } from "./DisclosureSummary";
import type { LinearRun } from "./linear-run";
export function LinearCreateIssue({
  host,
  scope,
  open,
  busy,
  notice,
  workspaceName,
  teamName,
  metadata,
  run,
  onClose,
  onCreated,
  onNotice,
}: {
  host: ArcoHost;
  scope: LinearScope;
  open: boolean;
  busy: boolean;
  notice: NoticeValue | null;
  workspaceName: string;
  teamName: string;
  metadata?: LinearMetadata;
  run: LinearRun;
  onClose: () => void;
  onCreated: (issue: LinearIssue | LinearSavedReceipt) => void;
  onNotice: (message: string, kind?: NoticeValue["kind"]) => void;
}) {
  const persistence = useDraftPersistence(host);
  const { load } = persistence;
  const hostAction = async (action: () => Promise<void>) => {
    onNotice("");
    try {
      await action();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error), "error");
    }
  };
  type CreateDraft = {
    title: string;
    body: string;
    templateId: string;
    descriptionTouched: boolean;
  };
  const createKey = useMemo<DraftKey>(
    () => ({
      source: "linear",
      workspaceId: scope.workspaceId,
      teamId: scope.teamId,
      issue: "new",
    }),
    [scope],
  );
  useEffect(() => {
    if (open) void load(createKey);
  }, [open, createKey, load]);
  const readCreateDraft = (): CreateDraft => {
    const saved = persistence.value(createKey);
    return {
      title: saved?.title ?? "",
      body: saved?.body ?? "",
      templateId: saved?.linearTemplateId ?? "",
      descriptionTouched: saved?.linearDescriptionTouched ?? false,
    };
  };
  const toSavedDraft = (draft: CreateDraft): Draft => ({
    title: draft.title,
    body: draft.body,
    comment: "",
    linearTemplateId: draft.templateId || undefined,
    linearDescriptionTouched: draft.descriptionTouched,
  });
  const createDraft = readCreateDraft();
  const setCreateDraft = (
    update: CreateDraft | ((previous: CreateDraft) => CreateDraft),
  ) => {
    const next =
      typeof update === "function" ? update(readCreateDraft()) : update;
    persistence.schedule(createKey, toSavedDraft(next));
  };
  const templates = useQuery({
    queryKey: ["linear-templates", scope],
    queryFn: () =>
      host.call<{ templates: LinearTemplate[] }>("linear_templates", {
        ...scope,
      }),
    enabled: open,
  });
  const selectedTemplate = templates.data?.templates.find(
    (template) => template.id === createDraft.templateId,
  );
  const submitCreate = () => {
    if (
      busy ||
      !createDraft.title.trim() ||
      (createDraft.templateId && !selectedTemplate?.supported)
    )
      return;
    void run<LinearIssue>("linear_create_issue", {
      ...scope,
      title: createDraft.title,
      ...(!createDraft.templateId || createDraft.descriptionTouched
        ? { body: createDraft.body }
        : {}),
      ...(createDraft.templateId ? { templateId: createDraft.templateId } : {}),
    }).then((result) => {
      if (result?.issueId) {
        onCreated(result);
        onClose();
        setCreateDraft({
          title: "",
          body: "",
          templateId: "",
          descriptionTouched: false,
        });
      }
    });
  };

  return (
    <CreateDialog
      open={open}
      busy={busy}
      title="Create Linear Issue"
      titleId="linear-create-title"
      closeLabel="Close create Linear Issue"
      onClose={onClose}
      scope={
        <>
          {workspaceName} / {teamName}
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitCreate();
        }}
      >
        <DraftStatus
          status={persistence.statuses[draftStorageId(createKey)]}
          onRetry={() =>
            persistence.retry(createKey, toSavedDraft(readCreateDraft()))
          }
          onResolve={(choice) => {
            void persistence.resolve(
              createKey,
              choice,
              toSavedDraft(readCreateDraft()),
            );
          }}
        />
        <label>
          Template
          <SingleSelect
            label="Linear template"
            value={createDraft.templateId}
            disabled={busy}
            options={[
              { value: "", label: "None" },
              ...(templates.data?.templates ?? []).map((template) => ({
                value: template.id,
                label: `${template.name}${
                  !template.supported
                    ? ` · Create in Linear: ${template.reason}`
                    : ""
                }`,
              })),
            ]}
            onChange={(value) => {
              const nextTemplate = templates.data?.templates.find(
                (template) => template.id === value,
              );
              setCreateDraft((previous) => {
                if (!nextTemplate?.supported)
                  return { ...previous, templateId: value };
                const previousTemplate = templates.data?.templates.find(
                  (template) => template.id === previous.templateId,
                );
                return {
                  ...previous,
                  templateId: nextTemplate.id,
                  title:
                    !previous.title ||
                    previous.title === previousTemplate?.defaults?.title
                      ? (nextTemplate.defaults?.title ?? previous.title)
                      : previous.title,
                  body: previous.descriptionTouched
                    ? previous.body
                    : (nextTemplate.defaults?.body ?? ""),
                };
              });
            }}
          />
        </label>
        {templates.isPending && (
          <p className="muted" role="status">
            Loading templates…
          </p>
        )}
        {templates.isError && (
          <p className="inline-error" role="alert">
            {templates.error.message}
          </p>
        )}
        {selectedTemplate && (
          <section className="linear-template-preview">
            <p className="muted">{selectedTemplate.description}</p>
            {selectedTemplate.supported ? (
              <>
                <p className="property-note">
                  Untouched descriptions use the template default. Editing the
                  description overrides it.
                </p>
                <LinearTemplateDefaults
                  template={selectedTemplate}
                  metadata={metadata}
                />
              </>
            ) : (
              <>
                <p className="inline-error">
                  {selectedTemplate.reason ||
                    "This template needs the official Linear flow."}
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    const url = new URL("https://linear.app/new");
                    url.searchParams.set("team", scope.teamId);
                    url.searchParams.set("template", selectedTemplate.id);
                    void hostAction(() => host.openLink(url.href));
                  }}
                >
                  Open Linear to use this template ↗
                </button>
              </>
            )}
          </section>
        )}
        <label>
          Title
          <input
            autoFocus
            value={createDraft.title}
            disabled={busy}
            onChange={(event) =>
              setCreateDraft((previous) => ({
                ...previous,
                title: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Markdown description
          <textarea
            rows={8}
            value={createDraft.body}
            disabled={busy}
            onChange={(event) =>
              setCreateDraft((previous) => ({
                ...previous,
                body: event.target.value,
                descriptionTouched: true,
              }))
            }
          />
        </label>
        <Notice notice={notice?.kind === "error" ? notice : null} />
        <div className="dialog-actions">
          <Button
            color="secondary"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            color="primary"
            disabled={
              busy ||
              !createDraft.title.trim() ||
              Boolean(createDraft.templateId && !selectedTemplate?.supported)
            }
            type="submit"
            loading={busy}
          >
            Create in Linear
          </Button>
        </div>
      </form>
    </CreateDialog>
  );
}

function LinearTemplateDefaults({
  template,
  metadata,
}: {
  template: LinearTemplate;
  metadata?: LinearMetadata;
}) {
  const defaults = template.defaults;
  if (!defaults) return null;
  const values: [string, string][] = [];
  if (defaults.stateId)
    values.push([
      "Workflow state",
      metadata?.states.find((state) => state.id === defaults.stateId)?.name ??
        "Unavailable in this team",
    ]);
  if (defaults.assigneeId !== undefined)
    values.push([
      "Assignee",
      defaults.assigneeId === null
        ? "Unassigned"
        : (metadata?.members.find((member) => member.id === defaults.assigneeId)
            ?.name ?? "Unavailable in this team"),
    ]);
  if (defaults.priority !== undefined)
    values.push([
      "Priority",
      ["No priority", "Urgent", "High", "Normal", "Low"][defaults.priority],
    ]);
  if (defaults.estimate !== undefined)
    values.push([
      "Estimate",
      defaults.estimate === null ? "Not set" : String(defaults.estimate),
    ]);
  if (defaults.dueDate !== undefined)
    values.push(["Due date", defaults.dueDate ?? "Not set"]);
  if (defaults.labelIds?.length)
    values.push([
      "Labels",
      defaults.labelIds
        .map(
          (id) =>
            metadata?.labels.find((label) => label.id === id)?.name ??
            "Unavailable label",
        )
        .join(", "),
    ]);
  if (defaults.projectId !== undefined)
    values.push([
      "Project",
      defaults.projectId === null
        ? "None"
        : (metadata?.projects.find(
            (project) => project.id === defaults.projectId,
          )?.name ?? "Unavailable Project"),
    ]);
  if (defaults.projectMilestoneId !== undefined)
    values.push([
      "Project milestone",
      defaults.projectMilestoneId === null
        ? "None"
        : (metadata?.milestones.find(
            (milestone) => milestone.id === defaults.projectMilestoneId,
          )?.name ?? "Unavailable milestone"),
    ]);
  if (defaults.cycleId !== undefined)
    values.push([
      "Cycle",
      defaults.cycleId === null
        ? "None"
        : (metadata?.cycles.find((cycle) => cycle.id === defaults.cycleId)
            ?.name ?? "Unavailable cycle"),
    ]);
  return values.length ? (
    <details>
      <DisclosureSummary>Initial template attributes</DisclosureSummary>
      <dl>
        {values.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  ) : null;
}
