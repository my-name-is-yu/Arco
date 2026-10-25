import type { IssueDetail } from "../shared/contracts";

const states = {
  open: { value: "open", label: "Open", reason: null },
  completed: {
    value: "completed",
    label: "Closed · Completed",
    reason: "Completed",
  },
  not_planned: {
    value: "not_planned",
    label: "Closed · Not planned",
    reason: "Not planned",
  },
  closed: { value: "closed", label: "Closed", reason: null, disabled: true },
};

export function githubStatePresentation(
  issue: Pick<IssueDetail, "state" | "stateReason">,
) {
  const state =
    issue.state === "open"
      ? states.open
      : issue.stateReason === "completed"
        ? states.completed
        : issue.stateReason === "not_planned"
          ? states.not_planned
          : states.closed;
  return {
    ...state,
    options: [
      states.open,
      states.completed,
      states.not_planned,
      ...(state === states.closed ? [state] : []),
    ],
  };
}
