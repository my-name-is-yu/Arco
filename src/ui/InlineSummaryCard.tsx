import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ArrowUpRight,
  DotsHorizontalMoreMenu,
} from "@openai/apps-sdk-ui/components/Icon";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import type { ArcoHost, ConversationIssue } from "../shared/contracts";
import { selectionIssueData } from "./selection-context";
import { Notice, type NoticeValue } from "./Notice";
import { IssueMarkdown } from "./MarkdownContent";
import { CopyValue } from "./CopyValue";
import { closeDetailUtility } from "./DetailToolbar";
import { useSessionRef } from "./session-state";
import { GitHubAuthScopeContext } from "./github-auth";
export function InlineSummaryCard({
  issue,
  host,
  busy = false,
  onOpen,
  onOpenLink,
  onToggleTask,
  properties,
  notice,
  footer,
}: {
  issue: ConversationIssue;
  host: ArcoHost;
  busy?: boolean;
  onOpen: () => void;
  onOpenLink: (url: string) => void;
  onToggleTask?: (line: number, checked: boolean) => void;
  properties: ReactNode;
  notice?: NoticeValue | null;
  footer?: string;
}) {
  const githubAuthScope = useContext(GitHubAuthScopeContext);
  const identifier =
    issue.source === "github"
      ? `${issue.repo} #${issue.number}`
      : issue.identifier;
  const utilities = useRef<HTMLDetailsElement>(null);
  const description = useRef<HTMLDivElement>(null);
  const scrollPositions = useSessionRef<Record<string, number>>(
    host,
    "inline:description-scroll",
    {},
  );
  useLayoutEffect(() => {
    if (description.current)
      description.current.scrollTop = scrollPositions.current[issue.url] ?? 0;
  }, [issue.url, scrollPositions]);
  const closeAfterCopy = (button: HTMLElement) => {
    if (utilities.current?.open) closeDetailUtility(button);
  };
  useEffect(() => {
    const menu = utilities.current;
    if (!menu) return;
    const owner = menu.ownerDocument;
    const view = owner.defaultView;
    const close = () => {
      menu.open = false;
    };
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !menu.contains(event.target)) close();
    };
    owner.addEventListener("pointerdown", closeOutside, true);
    owner.addEventListener("focusin", closeOutside, true);
    // Clicks in the surrounding conversation move focus out of Arco's iframe.
    view?.addEventListener("blur", close);
    return () => {
      owner.removeEventListener("pointerdown", closeOutside, true);
      owner.removeEventListener("focusin", closeOutside, true);
      view?.removeEventListener("blur", close);
    };
  }, []);
  return (
    <main
      className="arco compact-mode inline-mode inline-issue-card"
      data-arco-issue={selectionIssueData(issue)}
      data-arco-github-auth-generation={
        issue.source === "github" ? (githubAuthScope ?? undefined) : undefined
      }
      aria-busy={busy}
    >
      <div className="inline-card-top">
        <span className="muted">{identifier}</span>
        <div className="inline-card-actions">
          <Button color="secondary" variant="ghost" size="sm" onClick={onOpen}>
            Open details <ArrowUpRight aria-hidden="true" />
          </Button>
          <details
            ref={utilities}
            className="detail-utilities inline-card-utilities"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              event.preventDefault();
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }}
          >
            <summary aria-label="Issue actions" title="Issue actions">
              <DotsHorizontalMoreMenu aria-hidden="true" />
            </summary>
            <div className="detail-utility-menu">
              <CopyValue
                key={`link:${issue.url}`}
                value={issue.url}
                onCopied={closeAfterCopy}
              />
              <CopyValue
                key={`id:${issue.url}`}
                value={
                  issue.source === "github"
                    ? `${issue.repo}#${issue.number}`
                    : issue.identifier
                }
                label="Copy issue ID"
                onCopied={closeAfterCopy}
              />
              <button
                type="button"
                className="utility-item"
                onClick={(event) => {
                  closeDetailUtility(event.currentTarget);
                  onOpenLink(issue.url);
                }}
              >
                <ArrowUpRight aria-hidden="true" />
                {issue.source === "github"
                  ? "Open on GitHub"
                  : "Open in Linear"}
              </button>
            </div>
          </details>
        </div>
      </div>
      <h1>{issue.title}</h1>
      <div className="inline-properties">{properties}</div>
      <section
        className="inline-description"
        aria-label="Issue description"
        data-context-origin="body"
      >
        <div
          ref={description}
          className="inline-description-content"
          role="region"
          aria-label="Issue description text"
          tabIndex={0}
          onScroll={(event) => {
            scrollPositions.current[issue.url] = event.currentTarget.scrollTop;
          }}
        >
          <IssueMarkdown
            body={issue.body}
            onOpen={onOpenLink}
            image={{ host, issue }}
            busy={busy}
            onToggleTask={onToggleTask}
          />
        </div>
      </section>
      {footer && <span className="fixture-tag">{footer}</span>}
      <Notice notice={notice ?? null} />
    </main>
  );
}
