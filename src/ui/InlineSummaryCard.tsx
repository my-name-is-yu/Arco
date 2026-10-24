import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  DotsHorizontalMoreMenu,
} from "@openai/apps-sdk-ui/components/Icon";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ArcoHost, ConversationIssue } from "../shared/contracts";
import { selectionIssueData } from "./selection-context";
import { Notice, type NoticeValue } from "./Notice";
import { IssueMarkdown } from "./MarkdownContent";
import { inlineMarkdownPreview } from "./inline-markdown-preview";
import { CopyValue } from "./CopyValue";
import { closeDetailUtility } from "./DetailToolbar";
export function InlineSummaryCard({
  issue,
  host,
  shared,
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
  shared: boolean;
  busy?: boolean;
  onOpen: () => void;
  onOpenLink: (url: string) => void;
  onToggleTask?: (line: number, checked: boolean) => void;
  properties: ReactNode;
  notice?: NoticeValue | null;
  footer?: string;
}) {
  const identifier =
    issue.source === "github"
      ? `${issue.repo} #${issue.number}`
      : issue.identifier;
  const descriptionId = useId();
  const utilities = useRef<HTMLDetailsElement>(null);
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);
  const expanded = expandedIssue === issue.url;
  const preview = useMemo(
    () => inlineMarkdownPreview(issue.body),
    [issue.body],
  );
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
          id={descriptionId}
          className={
            preview.expandable && !expanded
              ? "inline-description-preview"
              : undefined
          }
          onFocusCapture={(event) => {
            if (expanded || !preview.expandable) return;
            const previewBounds = event.currentTarget.getBoundingClientRect();
            const focusedBounds = event.target.getBoundingClientRect();
            if (
              focusedBounds.bottom > previewBounds.bottom ||
              focusedBounds.top < previewBounds.top
            ) {
              setExpandedIssue(issue.url);
              const focused = event.target;
              requestAnimationFrame(() =>
                focused.scrollIntoView({ block: "nearest" }),
              );
            }
          }}
        >
          <IssueMarkdown
            body={expanded ? issue.body : preview.body}
            onOpen={onOpenLink}
            image={{ host, issue }}
            busy={busy}
            onToggleTask={onToggleTask}
          />
        </div>
        {preview.expandable && (
          <Button
            className="inline-description-toggle"
            color="secondary"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-controls={descriptionId}
            onClick={() => setExpandedIssue(expanded ? null : issue.url)}
          >
            {expanded ? "Collapse description" : "Expand description"}
            {expanded ? (
              <ChevronUp aria-hidden="true" />
            ) : (
              <ChevronDown aria-hidden="true" />
            )}
          </Button>
        )}
      </section>
      <div className="compact-bottom">
        <span className="muted">{shared ? "Shared issue" : "Browsing"}</span>
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
      </div>
      {footer && <span className="fixture-tag">{footer}</span>}
      <Notice notice={notice ?? null} />
    </main>
  );
}
