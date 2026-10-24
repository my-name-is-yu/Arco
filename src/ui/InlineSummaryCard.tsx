import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { ConversationIssue } from "../shared/contracts";
import { StateIcon } from "./GitHubIssueMeta";
import { selectionIssueData } from "./SelectionShare";
import { Notice, type NoticeValue } from "./Notice";
export function InlineSummaryCard({
  issue,
  shared,
  busy = false,
  onOpen,
  expandLabel = "Expand",
  notice,
  footer,
}: {
  issue: ConversationIssue;
  shared: boolean;
  busy?: boolean;
  onOpen: () => void;
  expandLabel?: string;
  notice?: NoticeValue | null;
  footer?: string;
}) {
  const identifier =
    issue.source === "github"
      ? `${issue.repo} #${issue.number}`
      : issue.identifier;
  return (
    <main
      className="arco compact-mode inline-mode"
      data-arco-issue={selectionIssueData(issue)}
      aria-busy={busy}
    >
      <div className="compact-top">
        <strong className="wordmark">
          Arco{issue.source === "linear" ? " · Linear" : ""}
        </strong>
        <span className="muted">{shared ? "Shared issue" : "Browsing"}</span>
        <button
          className="icon-button"
          aria-label={expandLabel}
          onClick={onOpen}
        >
          ↗
        </button>
      </div>
      <div className="issue-kicker">
        {issue.source === "github" ? (
          <StateIcon state={issue.state} />
        ) : (
          <span style={{ color: issue.state.color }}>◉</span>
        )}
        <span>{identifier}</span>
        {issue.source === "linear" && <span>{issue.state.name}</span>}
      </div>
      <h1>{issue.title}</h1>
      <p className="compact-summary">
        {issue.body.slice(0, 220)}
        {issue.body.length > 220 ? "…" : ""}
      </p>
      <div className="compact-bottom">
        <span className="muted">
          Updated{" "}
          <time
            dateTime={issue.updatedAt}
            title={new Date(issue.updatedAt).toLocaleString("en")}
          >
            {new Date(issue.updatedAt).toLocaleDateString("en", {
              month: "short",
              day: "numeric",
            })}
          </time>
        </span>
        <Button color="secondary" variant="outline" size="sm" onClick={onOpen}>
          Open details
        </Button>
      </div>
      {footer && <span className="fixture-tag">{footer}</span>}
      <Notice notice={notice ?? null} />
    </main>
  );
}
