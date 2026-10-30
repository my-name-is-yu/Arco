import {
  useContext,
  useId,
  useRef,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArcoHost } from "../shared/contracts";
import type {
  IssuePresentationSummary,
  NativeIssueTarget,
} from "../shared/launch";
import { Notice } from "./Notice";
import { isTextSelectionClick, selectionIssueData } from "./selection-context";
import { seedPresentationCache } from "./presentation-cache";
import { usePresentationImagePrefetch } from "./presentation-images";
import { githubStatePresentation } from "./github-state";
import { GitHubAuthScopeContext, isGitHubAuthScope } from "./github-auth";
import { ToolCallError } from "../shared/errors";
import "./inline-issue-tabs.css";
import { useIssueShortcuts } from "./keyboard-shortcuts";

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

function stateLabel(issue: IssuePresentationSummary) {
  if (issue.source === "linear") return issue.state.name;
  return githubStatePresentation(issue).label;
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
  const authScope = useContext(GitHubAuthScopeContext);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const targets = issues.map(presentationTarget);
  const activeKey = presentationIdentity(activeTarget);
  const hasGitHub = issues.some((issue) => issue.source === "github");
  const snapshot = host.presentationIssues?.();
  const matchingSnapshot =
    authScope !== null &&
    snapshot?.githubAuthGeneration === authScope &&
    snapshot.issues.length === targets.length &&
    snapshot.issues.every(
      (issue, index) =>
        presentationIdentity(issue) === presentationIdentity(targets[index]),
    )
      ? snapshot
      : undefined;
  const initialIssues = !hasGitHub
    ? issues
    : matchingSnapshot?.issues.map((issue): IssuePresentationSummary =>
        issue.source === "github"
          ? {
              source: issue.source,
              repo: issue.repo,
              number: issue.number,
              id: issue.id,
              title: issue.title,
              url: issue.url,
              state: issue.state,
              stateReason: issue.stateReason,
            }
          : {
              source: issue.source,
              connectionId: issue.connectionId,
              workspaceId: issue.workspaceId,
              teamId: issue.teamId,
              issueId: issue.issueId,
              identifier: issue.identifier,
              title: issue.title,
              url: issue.url,
              state: issue.state,
            },
      );
  const query = useQuery({
    queryKey: ["issue-set", targets, ...(hasGitHub ? [authScope] : [])],
    initialData: initialIssues,
    initialDataUpdatedAt: initialIssues ? snapshot?.receivedAt : undefined,
    queryFn: async ({ signal }) => {
      if (hasGitHub && (!authScope || !isGitHubAuthScope(client, authScope)))
        throw new ToolCallError(
          "auth",
          "GitHub authentication changed. Refresh these issues.",
        );
      const response = await host.call(
        "arco_show_issues",
        { targets },
        { signal },
      );
      if (
        hasGitHub &&
        response.presentation?.githubAuthGeneration !== authScope
      ) {
        void client.invalidateQueries({ queryKey: ["connection"] });
        throw new ToolCallError(
          "auth",
          "GitHub authentication changed. Refresh these issues.",
        );
      }
      seedPresentationCache(
        client,
        host,
        authScope ?? undefined,
        response.presentation,
      );
      return response.launch.issues;
    },
  });
  usePresentationImagePrefetch(
    host,
    query.dataUpdatedAt ? (snapshot?.issues ?? []) : [],
    snapshot?.githubAuthGeneration === authScope
      ? (authScope ?? undefined)
      : undefined,
  );
  const currentIssues = query.data ?? [];
  const activeIndex = currentIssues.findIndex(
    (issue) => presentationIdentity(issue) === activeKey,
  );
  const panelId = `${prefix}-panel`;
  const panel = useRef<HTMLDivElement>(null);
  const focusAfterSwitch = useRef<"tab" | "body" | null>(null);
  useLayoutEffect(() => {
    const destination = focusAfterSwitch.current;
    if (!destination) return;
    if (destination === "tab")
      buttons.current.get(activeKey)?.focus({ preventScroll: true });
    else panel.current?.focus({ preventScroll: true });
    focusAfterSwitch.current = null;
  }, [activeKey]);
  const moveIssue = (direction: -1 | 1) => {
    if (activeIndex < 0 || currentIssues.length < 2) return;
    focusAfterSwitch.current = document.activeElement?.closest(
      '[role="tablist"]',
    )
      ? "tab"
      : "body";
    onSelect(
      currentIssues[
        (activeIndex + direction + currentIssues.length) % currentIssues.length
      ],
    );
  };
  useIssueShortcuts("tabs", "tabs", {
    previous: {
      run: () => moveIssue(-1),
      enabled: activeIndex >= 0 && currentIssues.length > 1,
    },
    next: {
      run: () => moveIssue(1),
      enabled: activeIndex >= 0 && currentIssues.length > 1,
    },
  });
  return (
    <section
      className="arco inline-issue-tabs"
      aria-label="Issues"
      data-arco-github-auth-generation={
        hasGitHub ? (authScope ?? undefined) : undefined
      }
    >
      <div
        className="inline-issue-tablist"
        role="tablist"
        aria-label="Issues"
        data-motion="selection"
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey
          )
            return;
          if (!currentIssues.length) return;
          const last = currentIssues.length - 1;
          const index =
            event.key === "ArrowLeft"
              ? (activeIndex + last) % currentIssues.length
              : event.key === "ArrowRight"
                ? (activeIndex + 1) % currentIssues.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? last
                    : -1;
          if (index < 0) return;
          event.preventDefault();
          const issue = currentIssues[index];
          onSelect(issue);
          buttons.current
            .get(presentationIdentity(issue))
            ?.focus({ preventScroll: true });
        }}
      >
        {currentIssues.map((issue, index) => {
          const key = presentationIdentity(issue);
          const selected = key === activeKey;
          const label = `${issue.source === "github" ? `${issue.repo} #${issue.number}` : issue.identifier} ${issue.title}`;
          return (
            <button
              key={key}
              ref={(button) => {
                if (!button) {
                  buttons.current.delete(key);
                  return;
                }
                buttons.current.set(key, button);
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
        ref={panel}
        role="tabpanel"
        id={panelId}
        aria-labelledby={
          activeIndex >= 0 ? `${prefix}-tab-${activeIndex}` : undefined
        }
        aria-label={activeIndex < 0 ? "Issue details" : undefined}
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  );
}
