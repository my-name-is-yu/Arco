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
} from "../shared/github-operations";

type BulkInput = z.infer<typeof githubOperationSchemas.arco_bulk_update>;
export type BulkAttempt = {
  operation: string;
  targets: IssueRef[];
} & (
  | {
      name: "arco_bulk_update";
      args: Pick<BulkInput, "issues" | "requestId"> & {
        patch: Pick<
          NonNullable<BulkInput["patch"]>,
          "milestoneNumber" | "issueTypeId"
        >;
      };
    }
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
  call: ArcoHost["call"],
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
  const { patch } = attempt.args;
  const ref = { repo: issue.repo, number: issue.number };
  const catalog = await call<IssueCatalog>("arco_issue_catalog", ref);
  return (
    (patch.milestoneNumber === undefined ||
      catalog.milestoneNumber === patch.milestoneNumber) &&
    (patch.issueTypeId === undefined ||
      catalog.issueTypeId === patch.issueTypeId)
  );
}
