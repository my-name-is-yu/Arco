import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { ArcoHost, IssueDetail, IssueRef } from "../shared/contracts";
import type {
  FieldValue,
  GitHubOperationResult,
  IssueCatalog,
  IssueFieldList,
  ProjectChoices,
  ProjectFieldList,
  IssueField,
  ProjectField,
} from "../shared/github-operations";
import { useGitHubOperation } from "./useGitHubOperation";
import { SingleSelect } from "./SingleSelect";
import { MultiSelect } from "./MultiSelect";
import { DisclosureSummary } from "./DisclosureSummary";

type Memberships = {
  memberships: {
    projectId: string;
    itemId: string;
    title: string;
    url: string;
  }[];
  errors: string[];
};
const showValue = (value: FieldValue) =>
  value === null
    ? "Not set"
    : Array.isArray(value)
      ? value.join(", ")
      : String(value);

export function FieldEditor({
  field,
  kind,
  busy,
  onSave,
  saveLabel = "Save",
}: {
  field: IssueField | ProjectField;
  kind: "issue" | "project";
  busy: boolean;
  onSave: (value: FieldValue) => Promise<boolean>;
  saveLabel?: string;
}) {
  const [edited, setEdited] = useState(false);
  const [value, setValue] = useState<FieldValue>(field.value);
  const [base, setBase] = useState(field.value);
  const current = edited ? value : field.value;
  const type = field.type.toLowerCase().replace(/[_ -]/g, "");
  const changedElsewhere =
    edited && JSON.stringify(base) !== JSON.stringify(field.value);
  const set = (next: FieldValue) => {
    if (!edited) setBase(field.value);
    setValue(next);
    setEdited(true);
  };
  const choices = field.options.map((option) => ({
    value: kind === "issue" ? option.name : String(option.id),
    label: option.name,
  }));
  const numberValue =
    current === null || current === "" ? null : Number(current);
  const valid =
    type !== "number" || numberValue === null || Number.isFinite(numberValue);
  const save = async (next: FieldValue) => {
    if (await onSave(next)) setEdited(false);
  };
  return (
    <section className="field-editor">
      <div className="field-title">
        <strong>{field.name}</strong>
        <span>{field.type}</span>
      </div>
      {!field.supported ? (
        <p className="property-note">
          {showValue(field.value)} · Edit this field type on GitHub.
        </p>
      ) : (
        <>
          {type === "singleselect" ? (
            <SingleSelect
              label={`${field.name} value`}
              disabled={busy}
              value={typeof current === "string" ? current : ""}
              onChange={(value) => set(value || null)}
              options={[{ value: "", label: "Not set" }, ...choices]}
            />
          ) : type === "multiselect" ? (
            <MultiSelect
              label={field.name}
              value={Array.isArray(current) ? current : []}
              options={choices}
              disabled={busy}
              placeholder="Not set"
              onChange={set}
            />
          ) : type === "iteration" && "iterations" in field ? (
            <SingleSelect
              label={`${field.name} iteration`}
              disabled={busy}
              value={typeof current === "string" ? current : ""}
              onChange={(value) => set(value || null)}
              options={[
                { value: "", label: "Not set" },
                ...field.iterations.map((iteration) => ({
                  value: iteration.id,
                  label: `${iteration.title} · ${iteration.startDate}`,
                })),
              ]}
            />
          ) : (
            <input
              aria-label={`${field.name} value`}
              type={
                type === "number" ? "number" : type === "date" ? "date" : "text"
              }
              step={type === "number" ? "any" : undefined}
              disabled={busy}
              value={
                typeof current === "string" || typeof current === "number"
                  ? current
                  : ""
              }
              onChange={(event) => set(event.target.value || null)}
            />
          )}
          {changedElsewhere && (
            <p className="inline-error">
              The source value changed to “{showValue(field.value)}”.
              <button
                className="text-button"
                onClick={() => setBase(field.value)}
              >
                Keep draft after reviewing the latest value
              </button>
            </p>
          )}
          <div className="field-actions">
            <button
              className="text-button"
              disabled={busy || field.value === null}
              onClick={() => void save(null)}
            >
              Clear value
            </button>
            <Button
              color="secondary"
              variant="outline"
              size="3xs"
              disabled={busy || !edited || !valid || changedElsewhere}
              onClick={() =>
                void save(type === "number" ? numberValue : current)
              }
            >
              {saveLabel}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Catalog({ host, issue }: { host: ArcoHost; issue: IssueDetail }) {
  const query = useQuery({
    queryKey: ["github", "catalog", issue.repo, issue.number],
    queryFn: () =>
      host.call<IssueCatalog>("arco_issue_catalog", {
        repo: issue.repo,
        number: issue.number,
      }),
  });
  const action = useGitHubOperation(
    host,
    ["catalog", issue.repo, issue.number],
    issue,
  );
  const change = (patch: {
    milestoneNumber?: number | null;
    issueTypeId?: number | null;
  }) =>
    action.run<GitHubOperationResult>("arco_issue_attributes", {
      repo: issue.repo,
      number: issue.number,
      expectedUpdatedAt: issue.updatedAt,
      patch,
    });
  return (
    <section>
      <h3>Milestone and issue type</h3>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && (
        <p className="inline-error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.data && (
        <>
          <label className="property-select">
            Milestone
            <SingleSelect
              label="Change milestone"
              value={String(query.data.milestoneNumber ?? "")}
              disabled={action.busy}
              onChange={(value) =>
                void change({
                  milestoneNumber: value ? Number(value) : null,
                })
              }
              options={[
                { value: "", label: "None" },
                ...query.data.milestones.map((milestone) => ({
                  value: String(milestone.number),
                  label: `${milestone.title}${milestone.state === "closed" ? " (Closed)" : ""}`,
                })),
              ]}
            />
          </label>
          <label className="property-select">
            Issue type
            <SingleSelect
              label="Change issue type"
              value={String(query.data.issueTypeId ?? "")}
              disabled={action.busy}
              onChange={(value) =>
                void change({
                  issueTypeId: value ? Number(value) : null,
                })
              }
              options={[
                { value: "", label: "None" },
                ...query.data.issueTypes.map((type) => ({
                  value: String(type.id),
                  label: type.name,
                })),
              ]}
            />
          </label>
          {query.data.errors.map((error) => (
            <p key={error} className="inline-error" role="alert">
              {error}
            </p>
          ))}
        </>
      )}
      {action.error && (
        <p className="inline-error" role="alert">
          {action.error}
        </p>
      )}
    </section>
  );
}

function IssueFields({ host, issue }: { host: ArcoHost; issue: IssueRef }) {
  const query = useQuery({
    queryKey: ["github", "issue-fields", issue.repo, issue.number],
    queryFn: () =>
      host.call<IssueFieldList>("arco_issue_fields", {
        repo: issue.repo,
        number: issue.number,
      }),
  });
  const action = useGitHubOperation(
    host,
    ["issue-fields", issue.repo, issue.number],
    issue,
  );
  return (
    <section>
      <h3>Organization Issue fields</h3>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && (
        <p className="inline-error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.data?.error && (
        <p className="inline-error" role="alert">
          {query.data.error}
        </p>
      )}
      {query.data?.fields.map((field) => (
        <FieldEditor
          key={field.id}
          field={field}
          kind="issue"
          busy={action.busy}
          onSave={(value) =>
            action.run<GitHubOperationResult>("arco_set_issue_field", {
              repo: issue.repo,
              number: issue.number,
              fieldId: field.id,
              value,
            })
          }
        />
      ))}
      {query.isSuccess && !query.data.fields.length && !query.data.error && (
        <p className="property-note">No existing Issue fields are available.</p>
      )}
      {action.error && (
        <p className="inline-error" role="alert">
          {action.error}
        </p>
      )}
    </section>
  );
}

function ProjectFields({
  host,
  issue,
  projectId,
  itemId,
}: {
  host: ArcoHost;
  issue: IssueRef;
  projectId: string;
  itemId: string;
}) {
  const query = useQuery({
    queryKey: [
      "github",
      "project-fields",
      issue.repo,
      issue.number,
      projectId,
      itemId,
    ],
    queryFn: () =>
      host.call<ProjectFieldList>("arco_project_fields", {
        repo: issue.repo,
        number: issue.number,
        projectId,
        itemId,
      }),
  });
  const action = useGitHubOperation(
    host,
    ["project-fields", issue.repo, issue.number, projectId, itemId],
    issue,
  );
  return (
    <div className="project-field-list">
      {query.isPending && <p className="muted">Loading Project fields…</p>}
      {query.isError && (
        <p className="inline-error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.data?.fields.map((field) => (
        <FieldEditor
          key={field.id}
          field={field}
          kind="project"
          busy={action.busy}
          onSave={(value) =>
            action.run<GitHubOperationResult>("arco_set_project_field", {
              repo: issue.repo,
              number: issue.number,
              projectId,
              itemId,
              fieldId: field.id,
              value,
            })
          }
        />
      ))}
      {query.data?.hasMore && (
        <p className="property-note">
          View fields outside this API page on GitHub.
        </p>
      )}
      {action.error && (
        <p className="inline-error" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
}

function Projects({ host, issue }: { host: ArcoHost; issue: IssueRef }) {
  const [ownerDraft, setOwnerDraft] = useState(issue.repo.split("/")[0]);
  const [owner, setOwner] = useState(ownerDraft);
  const [ownerType, setOwnerType] = useState<"user" | "organization">("user");
  const [projectId, setProjectId] = useState("");
  const memberships = useQuery({
    queryKey: ["github", "memberships", issue.repo, issue.number],
    queryFn: () =>
      host.call<Memberships>("arco_issue_projects", {
        repo: issue.repo,
        number: issue.number,
      }),
  });
  const query = useInfiniteQuery({
    queryKey: ["github", "projects", issue.repo, owner, ownerType],
    queryFn: ({ pageParam }) =>
      host.call<ProjectChoices>("arco_projects", {
        repo: issue.repo,
        owner,
        ownerType,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.hasMore ? (last.cursor ?? undefined) : undefined,
  });
  const action = useGitHubOperation(
    host,
    ["project-memberships", issue.repo, issue.number],
    issue,
  );
  return (
    <section className="projects-manager">
      <h3>Project membership and fields</h3>
      {memberships.isError && (
        <p className="inline-error" role="alert">
          {memberships.error.message}
        </p>
      )}
      {memberships.data?.errors.map((error) => (
        <p key={error} className="inline-error" role="alert">
          {error}
        </p>
      ))}
      {memberships.data?.memberships.map((membership) => (
        <details className="project-membership" key={membership.itemId}>
          <DisclosureSummary>{membership.title}</DisclosureSummary>
          <ProjectFields
            host={host}
            issue={issue}
            projectId={membership.projectId}
            itemId={membership.itemId}
          />
          <Button
            color="secondary"
            variant="ghost"
            size="3xs"
            disabled={action.busy}
            onClick={() =>
              void action.run<GitHubOperationResult>(
                "arco_project_membership",
                {
                  repo: issue.repo,
                  number: issue.number,
                  projectId: membership.projectId,
                  itemId: membership.itemId,
                  action: "remove",
                },
              )
            }
          >
            Remove issue from this Project
          </Button>
        </details>
      ))}
      {memberships.isSuccess && !memberships.data.memberships.length && (
        <p className="property-note">No Project membership.</p>
      )}
      <form
        className="compact-form"
        onSubmit={(event) => {
          event.preventDefault();
          setOwner(ownerDraft.trim());
          setProjectId("");
        }}
      >
        <label>
          Project owner
          <input
            required
            pattern="[A-Za-z0-9-]+"
            value={ownerDraft}
            onChange={(event) => setOwnerDraft(event.target.value)}
          />
        </label>
        <label>
          Owner type
          <SingleSelect
            label="Project owner type"
            value={ownerType}
            onChange={(value) => {
              setOwnerType(value === "organization" ? "organization" : "user");
              setProjectId("");
            }}
            options={[
              { value: "user", label: "User" },
              { value: "organization", label: "Organization" },
            ]}
          />
        </label>
        <Button color="secondary" variant="outline" size="3xs" type="submit">
          Load existing Projects
        </Button>
      </form>
      {query.isError && (
        <p className="inline-error" role="alert">
          {query.error.message}
        </p>
      )}
      <label className="property-select">
        Add to an existing Project
        <SingleSelect
          label="Project to add"
          value={projectId}
          disabled={action.busy || query.isPending}
          onChange={setProjectId}
          options={[
            { value: "", label: "Choose a Project…" },
            ...(query.data?.pages
              .flatMap((page) => page.projects)
              .filter(
                (project) =>
                  !project.closed &&
                  !memberships.data?.memberships.some(
                    (member) => member.projectId === project.id,
                  ),
              )
              .map((project) => ({
                value: project.id,
                label: project.title,
              })) ?? []),
          ]}
        />
      </label>
      {query.hasNextPage && (
        <button
          className="text-button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more Projects
        </button>
      )}
      <Button
        color="secondary"
        variant="outline"
        size="3xs"
        disabled={action.busy || !projectId}
        onClick={() =>
          void action.run<GitHubOperationResult>(
            "arco_project_membership",
            {
              repo: issue.repo,
              number: issue.number,
              projectId,
              action: "add",
            },
            () => setProjectId(""),
          )
        }
      >
        Add this issue
      </Button>
      <p className="property-note">
        Manage Project and field definitions on GitHub.
      </p>
      {action.error && (
        <p className="inline-error" role="alert">
          {action.error}
        </p>
      )}
    </section>
  );
}

export function GitHubProperties({
  host,
  issue,
}: {
  host: ArcoHost;
  issue: IssueDetail;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="advanced-section"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <DisclosureSummary>Edit attributes and membership</DisclosureSummary>
      {open && (
        <>
          <Catalog host={host} issue={issue} />
          <IssueFields host={host} issue={issue} />
          <Projects host={host} issue={issue} />
        </>
      )}
    </details>
  );
}
