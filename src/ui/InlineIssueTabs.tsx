import { useId, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArcoHost } from "../shared/contracts";
import {
  launchContextSchema,
  type IssuePresentationSummary,
  type NativeIssueTarget,
} from "../shared/launch";
import { Notice } from "./Notice";
import { isTextSelectionClick, selectionIssueData } from "./selection-context";
import { seedPresentationCache } from "./presentation-cache";
import { usePresentationImagePrefetch } from "./presentation-images";
import "./inline-issue-tabs.css";

export function presentationTarget(
  issue: IssuePresentationSummary,
): NativeIssueTarget {
  return issue.source === "github"
    ? { source: "github", repo: issue.repo, number: issue.number }
    : {
        source: "linear",
        connectionId: issue.connectionId,
        workspaceId: issue.workspaceId,
        teamId: issue.teamId,
        issueId: issue.issueId,
      };
}

export function presentationIdentity(target: NativeIssueTarget) {
  return JSON.stringify(
    target.source === "github"
      ? [target.source, target.repo.toLowerCase(), target.number]
      : [
          target.source,
          target.connectionId,
          target.workspaceId,
          target.teamId,
          target.issueId,
        ],
  );
}

function identifier(issue: IssuePresentationSummary) {
  return issue.source === "github"
    ? `${issue.repo} #${issue.number}`
    : issue.identifier;
}

function stateLabel(issue: IssuePresentationSummary) {
  if (issue.source === "linear") return issue.state.name;
  if (issue.state === "open") return "Open";
  return issue.stateReason === "completed"
    ? "Closed · Completed"
    : issue.stateReason === "not_planned"
      ? "Closed · Not planned"
      : "Closed";
}

export function InlineIssueTabs({
  host,
  issues,
  activeTarget,
  onSelect,
  children,
}: {
  host: ArcoHost;
  issues: IssuePresentationSummary[];
  activeTarget: NativeIssueTarget;
  onSelect: (issue: IssuePresentationSummary) => void;
  children: ReactNode;
}) {
  const prefix = useId();
  const client = useQueryClient();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const targets = issues.map(presentationTarget);
  const activeKey = presentationIdentity(activeTarget);
  const query = useQuery({
    queryKey: ["issue-set", targets],
    initialData: issues,
    initialDataUpdatedAt: host.presentationIssues?.()?.receivedAt,
    queryFn: async ({ signal }) => {
      const response = await host.call<{ launch: unknown }>(
        "arco_show_issues",
        { targets },
        { signal },
      );
      const refreshed = launchContextSchema.parse(response.launch).issues;
      if (
        !refreshed ||
        refreshed.length !== issues.length ||
        refreshed.some(
          (issue, index) =>
            presentationIdentity(issue) !== presentationIdentity(issues[index]),
        )
      )
        throw new Error(
          "The issue tabs returned different targets. Try refreshing again.",
        );
      seedPresentationCache(client, host);
      return refreshed;
    },
  });
  usePresentationImagePrefetch(
    host,
    query.dataUpdatedAt ? (host.presentationIssues?.()?.issues ?? []) : [],
  );
  const activeIndex = query.data.findIndex(
    (issue) => presentationIdentity(issue) === activeKey,
  );
  const panelId = `${prefix}-panel`;
  return (
    <section className="arco inline-issue-tabs" aria-label="Issues">
      <div
        className="inline-issue-tablist"
        role="tablist"
        aria-label="Issues"
        data-motion="selection"
        onKeyDown={(event) => {
          const last = query.data.length - 1;
          const index =
            event.key === "ArrowLeft"
              ? (activeIndex + last) % query.data.length
              : event.key === "ArrowRight"
                ? (activeIndex + 1) % query.data.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? last
                    : -1;
          if (index < 0) return;
          event.preventDefault();
          const issue = query.data[index];
          onSelect(issue);
          buttons.current
            .get(presentationIdentity(issue))
            ?.focus({ preventScroll: true });
        }}
      >
        {query.data.map((issue, index) => {
          const key = presentationIdentity(issue);
          const selected = key === activeKey;
          const label = `${identifier(issue)} ${issue.title}`;
          return (
            <button
              key={key}
              ref={(button) => {
                if (button) buttons.current.set(key, button);
                else buttons.current.delete(key);
              }}
              type="button"
              className="inline-issue-tab"
              role="tab"
              id={`${prefix}-tab-${index}`}
              aria-label={label}
              aria-description={stateLabel(issue)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              title={`${label} · ${stateLabel(issue)}`}
              data-arco-issue={selectionIssueData(issue)}
              onClick={(event) => {
                if (
                  event.detail > 0 &&
                  isTextSelectionClick(event.currentTarget)
                )
                  return;
                onSelect(issue);
              }}
            >
              <span className="inline-issue-tab-identifier">
                {issue.source === "github"
                  ? `#${issue.number}`
                  : issue.identifier}
              </span>
              <span className="inline-issue-tab-title">{issue.title}</span>
            </button>
          );
        })}
      </div>
      {query.isError && (
        <Notice
          notice={{
            kind: "error",
            text: `Could not refresh issues. ${query.error.message}`,
          }}
        >
          <button
            type="button"
            className="text-button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry refresh
          </button>
        </Notice>
      )}
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${prefix}-tab-${activeIndex}`}
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  );
}
