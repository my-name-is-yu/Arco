import type { z } from "zod";
import type {
  ArcoHost,
  IssueDetail,
  IssueRef,
  LabelInput,
  UpdateInput,
} from "../shared/contracts";
import { OperationError } from "../shared/errors";
import type {
  githubOperationSchemas,
  IssueCatalog,
  IssueFieldList,
  IssueProjectMemberships,
  ProjectFieldList,
} from "../shared/github-operations";

type BulkInput = z.infer<typeof githubOperationSchemas.arco_bulk_update>;
export type BulkAttempt = {
  operation: string;
  targets: IssueRef[];
} & (
  | { name: "arco_bulk_update"; args: BulkInput }
  | { name: "arco_update_issue"; args: UpdateInput }
  | { name: "arco_change_labels"; args: LabelInput }
);

export type UnconfirmedBulkAttempt = {
  attempt: BulkAttempt;
  targets: IssueRef[];
  replay: boolean;
  error: string;
};

export const bulkIssueId = (issue: IssueRef) =>
  `${issue.repo.toLowerCase()}#${issue.number}`;

export function isRejectedBulkCall(error: unknown) {
  return (
    error instanceof OperationError &&
    [
      "auth",
      "forbidden",
      "rate-limited",
      "not-found",
      "conflict",
      "unsupported",
      "invalid-input",
      "invalid",
    ].includes(error.code)
  );
}

const sameValue = (actual: unknown, expected: unknown) =>
  Array.isArray(actual) && Array.isArray(expected)
    ? JSON.stringify([...actual].sort()) ===
      JSON.stringify([...expected].sort())
    : actual === expected;

// Read the source without repeating a mutation whose result is unconfirmed.
export async function checkBulkChange(
  host: ArcoHost,
  attempt: BulkAttempt,
  issue: IssueDetail,
) {
  if (attempt.name === "arco_change_labels") {
    const labels = new Set(
      issue.labels.map((label) => label.name.toLowerCase()),
    );
    return (
      attempt.args.add.every((label) => labels.has(label.toLowerCase())) &&
      attempt.args.remove.every((label) => !labels.has(label.toLowerCase()))
    );
  }
  if (attempt.name === "arco_update_issue") {
    const { state, stateReason, assignees } = attempt.args.patch;
    return (
      (state === undefined || issue.state === state) &&
      (stateReason === undefined || issue.stateReason === stateReason) &&
      (assignees === undefined || sameValue(issue.assignees, assignees))
    );
  }
  const { patch, issueField, projectField } = attempt.args;
  const ref = { repo: issue.repo, number: issue.number };
  if (patch) {
    const catalog = await host.call<IssueCatalog>("arco_issue_catalog", ref);
    return (
      (patch.milestoneNumber === undefined ||
        catalog.milestoneNumber === patch.milestoneNumber) &&
      (patch.issueTypeId === undefined ||
        catalog.issueTypeId === patch.issueTypeId)
    );
  }
  if (issueField) {
    const response = await host.call<IssueFieldList>("arco_issue_fields", ref);
    if (response.error) throw new Error(response.error);
    const field = response.fields.find(
      (field) => field.id === issueField.fieldId,
    );
    return Boolean(field && sameValue(field.value, issueField.value));
  }
  if (projectField) {
    const memberships = await host.call<IssueProjectMemberships>(
      "arco_issue_projects",
      ref,
    );
    const member = memberships.memberships.find(
      (member) => member.projectId === projectField.projectId,
    );
    if (!member && memberships.errors.length)
      throw new Error(memberships.errors.join(" "));
    if (!member) return false;
    const response = await host.call<ProjectFieldList>("arco_project_fields", {
      ...ref,
      projectId: projectField.projectId,
      itemId: member.itemId,
    });
    const field = response.fields.find(
      (field) => field.id === projectField.fieldId,
    );
    if (!field && response.hasMore)
      throw new Error(
        "The current Project field was not included in this page.",
      );
    return Boolean(field && sameValue(field.value, projectField.value));
  }
  return false;
}
