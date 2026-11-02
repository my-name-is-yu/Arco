import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { ArcoHost } from "../shared/contracts";
import type { LinearIssue } from "../shared/linear";
import { SingleSelect } from "./SingleSelect";
import { DisclosureSummary } from "./DisclosureSummary";
import { useSessionState } from "./session-state";
import type { LinearRun } from "./linear-run";
import { useEffect, useMemo } from "react";
import type { DraftKey } from "../shared/state";
import { DraftStatus, useDraftPersistence } from "./useDraftPersistence";
const relationLabels: Record<string, string> = {
  blocks: "Blocks",
  "blocked-by": "Blocked by",
  related: "Related to",
};
const ref = (issue: LinearIssue) => ({
  connectionId: issue.connectionId,
  workspaceId: issue.workspaceId,
  teamId: issue.teamId,
  issueId: issue.issueId,
});
export function LinearRelations({
  host,
  ownerId,
  issue,
  busy,
  run,
}: {
  host: ArcoHost;
  ownerId: string;
  issue: LinearIssue;
  busy: boolean;
  run: LinearRun;
}) {
  const identity = `${ownerId}:${issue.connectionId}:${issue.workspaceId}:${issue.teamId}:${issue.issueId}`;
  const [relationTarget, setRelationTarget] = useSessionState(
    host,
    `linear:relation-target:${identity}`,
    "",
  );
  const [relationKind, setRelationKind] = useSessionState<
    "blocks" | "blocked-by" | "related"
  >(host, `linear:relation-kind:${identity}`, "related");
  const [parentId, setParentId] = useSessionState(
    host,
    `linear:parent-target:${identity}`,
    "",
  );
  const childKey = useMemo<DraftKey>(
    () => ({
      source: "linear",
      ownerId,
      workspaceId: issue.workspaceId,
      teamId: issue.teamId,
      issue: `child:${issue.issueId}`,
    }),
    [issue.workspaceId, issue.teamId, issue.issueId, ownerId],
  );
  const persistence = useDraftPersistence(host, childKey);
  const { load } = persistence;
  useEffect(() => {
    void load(childKey);
  }, [load, childKey]);
  const childDraft = persistence.value(childKey);
  const child = {
    title: childDraft?.title ?? "",
    body: childDraft?.body ?? "",
  };
  const setChild = (
    update: typeof child | ((previous: typeof child) => typeof child),
  ) => {
    const current = persistence.value(childKey);
    const previous = { title: current?.title ?? "", body: current?.body ?? "" };
    const next = typeof update === "function" ? update(previous) : update;
    persistence.schedule(childKey, { ...next, comment: "" });
  };
  const update = (patch: Record<string, unknown>) =>
    run<LinearIssue>("linear_update_issue", {
      ...ref(issue),
      expectedUpdatedAt: issue.updatedAt,
      patch,
    });
  return (
    <details className="linear-extra">
      <DisclosureSummary>Parent, sub-issues and relations</DisclosureSummary>
      <p>
        Parent:{" "}
        {issue.parent
          ? `${issue.parent.identifier} ${issue.parent.title}`
          : "None"}
      </p>
      {issue.parent && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void update({ parentId: null })}
        >
          Remove parent
        </button>
      )}
      <div className="linear-controls">
        <input
          aria-label="Linear parent issue"
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
          placeholder="Parent issue (e.g. ABC-123)"
        />
        <Button
          color="secondary"
          variant="outline"
          size="sm"
          disabled={busy || !parentId.trim()}
          onClick={() => void update({ parentId: parentId.trim() })}
        >
          Set or replace parent
        </Button>
      </div>
      {issue.children.map((child) => (
        <p key={child.id}>
          {child.identifier} {child.title}
        </p>
      ))}
      <details>
        <DisclosureSummary>Create sub-issue</DisclosureSummary>
        <DraftStatus
          status={persistence.status}
          onRetry={() => persistence.retry(childKey, { ...child, comment: "" })}
          onResolve={(choice) => {
            void persistence.resolve(childKey, choice, {
              ...child,
              comment: "",
            });
          }}
        />
        <label>
          Title
          <input
            disabled={busy}
            aria-label="Sub-issue title"
            value={child.title}
            onChange={(event) =>
              setChild((previous) => ({
                ...previous,
                title: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Description
          <textarea
            disabled={busy}
            aria-label="Sub-issue description"
            value={child.body}
            onChange={(event) =>
              setChild((previous) => ({
                ...previous,
                body: event.target.value,
              }))
            }
          />
        </label>
        <Button
          color="secondary"
          variant="outline"
          size="sm"
          disabled={busy || !child.title.trim()}
          onClick={() =>
            void run<LinearIssue>("linear_create_issue", {
              connectionId: issue.connectionId,
              workspaceId: issue.workspaceId,
              teamId: issue.teamId,
              parentId: issue.issueId,
              ...child,
            }).then((result) => {
              if (result) setChild({ title: "", body: "" });
            })
          }
        >
          Create sub-issue in Linear
        </Button>
      </details>
      {issue.relations.map((relation) => (
        <div key={relation.id}>
          <span>
            {relationLabels[relation.type] ?? "Related issue"}:{" "}
            {relation.identifier} {relation.title}
          </span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void run("linear_relation", {
                ...ref(issue),
                action: "remove",
                relationId: relation.id,
                kind: ["blocks", "blocked-by"].includes(relation.type)
                  ? relation.type
                  : "related",
              })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <div className="linear-controls">
        <label>
          Relation kind
          <SingleSelect
            label="Linear relation kind"
            value={relationKind}
            options={[
              { value: "blocks", label: "blocks" },
              { value: "blocked-by", label: "blocked by" },
              { value: "related", label: "related" },
            ]}
            onChange={(value) =>
              setRelationKind(
                value === "blocks"
                  ? "blocks"
                  : value === "blocked-by"
                    ? "blocked-by"
                    : "related",
              )
            }
          />
        </label>
        <input
          aria-label="Related Linear issue"
          value={relationTarget}
          onChange={(event) => setRelationTarget(event.target.value)}
          placeholder="Related issue (e.g. ABC-123)"
        />
        <Button
          color="secondary"
          variant="outline"
          size="sm"
          disabled={busy || !relationTarget.trim()}
          onClick={() =>
            void run("linear_relation", {
              ...ref(issue),
              action: "add",
              relatedIssueId: relationTarget.trim(),
              kind: relationKind,
            })
          }
        >
          Add relation
        </Button>
      </div>
    </details>
  );
}
