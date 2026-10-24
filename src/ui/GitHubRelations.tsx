import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { repoSchema, type ArcoHost, type IssueRef } from "../shared/contracts";
import type {
  GitHubOperationResult,
  IssueRelations,
  RelatedIssue,
} from "../shared/github-operations";
import { useGitHubOperation } from "./useGitHubOperation";
import { SingleSelect } from "./SingleSelect";
import {
  DraftStatus,
  draftStorageId,
  useDraftPersistence,
} from "./useDraftPersistence";
import type { Draft, DraftKey } from "../shared/state";
import { DisclosureSummary } from "./DisclosureSummary";

type RelationKind = "parent" | "child" | "blocked-by";
export function GitHubRelations({
  host,
  issue,
}: {
  host: ArcoHost;
  issue: IssueRef;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RelationKind>("blocked-by");
  const [repo, setRepo] = useState(issue.repo);
  const [number, setNumber] = useState("");
  const [replace, setReplace] = useState(false);
  const [child, setChild] = useState({ repo: issue.repo, title: "", body: "" });
  const childRef = useRef(child);
  const childTouched = useRef(false);
  const childPersistence = useDraftPersistence(host);
  const { load: loadChildDraft } = childPersistence;
  const childKey = useMemo<DraftKey>(
    () => ({
      source: "github",
      repo: issue.repo,
      issue: `child:${issue.number}`,
    }),
    [issue.repo, issue.number],
  );
  const childDraft = (value = childRef.current): Draft => ({
    title: value.title,
    body: value.body,
    comment: "",
    githubChildRepo: value.repo,
  });
  const restoreChild = (draft: Draft | null | undefined) => {
    if (draft === undefined) return;
    const next = {
      title: draft?.title ?? "",
      body: draft?.body ?? "",
      repo: draft?.githubChildRepo ?? issue.repo,
    };
    childRef.current = next;
    setChild(next);
  };
  useEffect(() => {
    let active = true;
    void loadChildDraft(childKey).then((saved) => {
      if (active && saved && !childTouched.current) {
        const next = {
          title: saved.title,
          body: saved.body,
          repo: saved.githubChildRepo ?? issue.repo,
        };
        childRef.current = next;
        setChild(next);
      }
    });
    return () => {
      active = false;
    };
  }, [loadChildDraft, childKey, issue.repo]);
  const editChild = (patch: Partial<typeof child>) => {
    childTouched.current = true;
    const next = { ...childRef.current, ...patch };
    childRef.current = next;
    setChild(next);
    childPersistence.schedule(childKey, childDraft(next));
  };
  const [createChild, setCreateChild] = useState(false);
  const query = useQuery({
    queryKey: ["github", "relations", issue.repo, issue.number],
    queryFn: () =>
      host.call<IssueRelations>("arco_issue_relations", {
        repo: issue.repo,
        number: issue.number,
      }),
    enabled: open,
  });
  const action = useGitHubOperation(
    host,
    ["relations", issue.repo, issue.number],
    issue,
  );
  const valid =
    repoSchema.safeParse(repo).success &&
    /^[1-9]\d*$/.test(number) &&
    Number.isSafeInteger(Number(number)) &&
    !(repo === issue.repo && Number(number) === issue.number);
  const add = async () => {
    if (!valid) return;
    const other = { repo, number: Number(number) };
    const name =
      kind === "blocked-by" ? "arco_add_dependency" : "arco_set_parent";
    const args =
      kind === "blocked-by"
        ? { repo: issue.repo, number: issue.number, blockedBy: other }
        : kind === "parent"
          ? { repo: issue.repo, number: issue.number, parent: other, replace }
          : {
              ...other,
              parent: { repo: issue.repo, number: issue.number },
              replace,
            };
    await action.run<GitHubOperationResult>(name, args, () => {
      setNumber("");
      setReplace(false);
    });
  };
  const row = (
    related: RelatedIssue,
    relation: "parent" | "child" | "blocked-by" | "blocking",
  ) => (
    <li key={`${related.repo}#${related.number}`}>
      <div>
        <button
          className="text-button related-title"
          onClick={() => void host.openLink(related.url)}
        >
          {related.repo} #{related.number} · {related.title} ↗
        </button>
        <span className="property-note">{related.state}</span>
      </div>
      <button
        className="text-button"
        disabled={action.busy}
        onClick={() =>
          void action.run<GitHubOperationResult>(
            relation === "parent" || relation === "child"
              ? "arco_remove_parent"
              : "arco_remove_dependency",
            relation === "parent"
              ? {
                  repo: issue.repo,
                  number: issue.number,
                  parent: { repo: related.repo, number: related.number },
                }
              : relation === "child"
                ? {
                    repo: related.repo,
                    number: related.number,
                    parent: { repo: issue.repo, number: issue.number },
                  }
                : relation === "blocked-by"
                  ? {
                      repo: issue.repo,
                      number: issue.number,
                      blockedBy: { repo: related.repo, number: related.number },
                    }
                  : {
                      repo: related.repo,
                      number: related.number,
                      blockedBy: { repo: issue.repo, number: issue.number },
                    },
          )
        }
      >
        Remove relationship
      </button>
    </li>
  );
  return (
    <details
      className="advanced-section relations-manager"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <DisclosureSummary>
        Parent, sub-issues, and dependencies
      </DisclosureSummary>
      {query.isPending && open && (
        <p className="muted">Loading relationships…</p>
      )}
      {query.isError && (
        <p className="inline-error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.data && (
        <>
          <h3>Parent issue</h3>
          <ul className="relation-list">
            {query.data.parent ? (
              row(query.data.parent, "parent")
            ) : (
              <li className="muted">None</li>
            )}
          </ul>
          <h3>Sub-issues</h3>
          <ul className="relation-list">
            {query.data.children.length ? (
              query.data.children.map((child) => row(child, "child"))
            ) : (
              <li className="muted">None</li>
            )}
          </ul>
          <h3>Blocked by</h3>
          <ul className="relation-list">
            {query.data.blockedBy.length ? (
              query.data.blockedBy.map((other) => row(other, "blocked-by"))
            ) : (
              <li className="muted">None</li>
            )}
          </ul>
          <h3>Blocking</h3>
          <ul className="relation-list">
            {query.data.blocking.length ? (
              query.data.blocking.map((other) => row(other, "blocking"))
            ) : (
              <li className="muted">None</li>
            )}
          </ul>
          {query.data.errors.map((error) => (
            <p className="inline-error" role="alert" key={error}>
              {error}
            </p>
          ))}
        </>
      )}
      <form
        className="compact-form"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <h3>Link an existing issue</h3>
        <label>
          Relationship
          <SingleSelect
            label="Relationship to add"
            value={kind}
            disabled={action.busy}
            onChange={(value) => setKind(value as RelationKind)}
            options={[
              {
                value: "blocked-by",
                label: "Make this a prerequisite · Blocked by",
              },
              { value: "parent", label: "Set as parent" },
              { value: "child", label: "Set as sub-issue" },
            ]}
          />
        </label>
        <label>
          Repository
          <input
            aria-label="Related issue repository"
            value={repo}
            disabled={action.busy}
            onChange={(event) => setRepo(event.target.value)}
          />
        </label>
        <label>
          Issue number
          <input
            aria-label="Related issue number"
            type="number"
            min={1}
            step={1}
            value={number}
            disabled={action.busy}
            onChange={(event) => setNumber(event.target.value)}
          />
        </label>
        {kind !== "blocked-by" && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={replace}
              disabled={action.busy}
              onChange={(event) => setReplace(event.target.checked)}
            />
            Replace an existing parent
          </label>
        )}
        <Button
          color="secondary"
          variant="outline"
          size="sm"
          type="submit"
          disabled={action.busy || !valid}
        >
          Save relationship
        </Button>
      </form>
      <button
        className="text-button"
        aria-expanded={createChild}
        onClick={() => setCreateChild((value) => !value)}
      >
        Create a sub-issue
      </button>
      <DraftStatus
        status={childPersistence.statuses[draftStorageId(childKey)]}
        onRetry={() => childPersistence.retry(childKey, childDraft())}
        onResolve={(choice) =>
          void childPersistence
            .resolve(childKey, choice, childDraft())
            .then(restoreChild)
        }
      />
      {createChild && (
        <form
          className="compact-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run<GitHubOperationResult>(
              "arco_create_sub_issue",
              {
                repo: issue.repo,
                number: issue.number,
                childRepo: child.repo,
                title: child.title,
                body: child.body,
              },
              () => {
                childRef.current = { repo: issue.repo, title: "", body: "" };
                setChild(childRef.current);
                void childPersistence.remove(childKey);
                setCreateChild(false);
              },
            );
          }}
        >
          <p className="property-note">
            Parent: {issue.repo} #{issue.number}. A new issue will be created on
            the source.
          </p>
          <label>
            Sub-issue repository
            <input
              value={child.repo}
              disabled={action.busy}
              onChange={(event) => editChild({ repo: event.target.value })}
            />
          </label>
          <label>
            Sub-issue title
            <input
              required
              maxLength={256}
              value={child.title}
              disabled={action.busy}
              onChange={(event) => editChild({ title: event.target.value })}
            />
          </label>
          <label>
            Sub-issue body
            <textarea
              rows={4}
              value={child.body}
              disabled={action.busy}
              onChange={(event) => editChild({ body: event.target.value })}
            />
          </label>
          <Button
            color="secondary"
            variant="outline"
            size="sm"
            type="submit"
            disabled={
              action.busy ||
              !child.title.trim() ||
              !repoSchema.safeParse(child.repo).success
            }
          >
            Create sub-issue
          </Button>
        </form>
      )}
      {action.error && (
        <p className="inline-error" role="alert">
          {action.error}
        </p>
      )}
      {action.saved && (
        <p className="operation-saved" role="status">
          Relationship saved and refreshed.
        </p>
      )}
    </details>
  );
}
