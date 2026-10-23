import { Children, isValidElement } from "react";
import { Markdown } from "@openai/apps-sdk-ui/components/Markdown";
import { useQuery } from "@tanstack/react-query";
import type { ArcoHost, ConversationIssue } from "../shared/contracts";
import { markdownTaskAtLine } from "./markdown-tasks";

type ImageContext = {
  host: ArcoHost;
  issue: ConversationIssue;
  commentId?: string | number;
};

function SourceImage({
  url,
  alt,
  image,
  onOpen,
}: {
  url: string;
  alt: string;
  image?: ImageContext;
  onOpen: (url: string) => void;
}) {
  const issue = image?.issue;
  const sourceRef =
    issue?.source === "github"
      ? [issue.repo, issue.number]
      : issue?.source === "linear"
        ? [issue.connectionId, issue.workspaceId, issue.teamId, issue.issueId]
        : [];
  const preview = useQuery({
    queryKey: [
      "source-image",
      issue?.source,
      ...sourceRef,
      image?.commentId,
      url,
    ],
    queryFn: () => image!.host.readImage(image!.issue, url, image!.commentId),
    enabled: Boolean(image),
    retry: false,
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
  });
  return (
    <span className="source-image">
      {preview.data && (
        <img
          src={`data:${preview.data.mimeType};base64,${preview.data.data}`}
          alt={alt}
          loading="lazy"
        />
      )}
      {image && preview.isPending && (
        <span className="muted">Loading {alt}… </span>
      )}
      {preview.isError && (
        <span className="muted">Image preview unavailable. </span>
      )}
      <button
        type="button"
        className="markdown-link attachment-link"
        onClick={() => onOpen(url)}
      >
        Open {alt} ↗
      </button>
    </span>
  );
}

function property(node: Record<string, unknown>, key: string): string {
  const properties = node.properties;
  if (!properties || typeof properties !== "object") return "";
  const value: unknown = Object.entries(properties).find(
    ([name]) => name === key,
  )?.[1];
  return typeof value === "string" ? value : "";
}
function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function linePosition(node: Record<string, unknown>): number | undefined {
  const position = node.position;
  if (!position || typeof position !== "object" || !("start" in position))
    return undefined;
  const start = position.start;
  return start &&
    typeof start === "object" &&
    "line" in start &&
    typeof start.line === "number"
    ? start.line
    : undefined;
}

export function IssueMarkdown({
  body,
  onOpen,
  onToggleTask,
  busy = false,
  image,
}: {
  body: string;
  onOpen: (url: string) => void;
  onToggleTask?: (line: number, checked: boolean) => void;
  busy?: boolean;
  image?: ImageContext;
}) {
  return (
    <>
      <Markdown
        className="issue-markdown"
        includeMath={false}
        skipHtml
        components={{
          a: ({ node, children }) => {
            const url = safeUrl(property(node, "href"));
            return url ? (
              <button
                type="button"
                className="markdown-link"
                onClick={() => onOpen(url)}
              >
                {children}
              </button>
            ) : (
              <span>{children}</span>
            );
          },
          img: ({ node }) => {
            const url = safeUrl(property(node, "src"));
            const alt = property(node, "alt") || "Attached image";
            return url ? (
              <SourceImage url={url} alt={alt} image={image} onOpen={onOpen} />
            ) : (
              <span>{alt}</span>
            );
          },
          li: ({ node, children, className }) => {
            const line = linePosition(node);
            const task = line ? markdownTaskAtLine(body, line) : null;
            if (!task || !line || !onToggleTask)
              return <li className={className}>{children}</li>;
            return (
              <li className="task-list-item">
                <input
                  type="checkbox"
                  checked={task.checked}
                  disabled={busy}
                  aria-label={`Completion of ${task.text}`}
                  onChange={(event) => onToggleTask(line, event.target.checked)}
                />
                {Children.toArray(children).filter(
                  (child) => !isValidElement(child) || child.type !== "input",
                )}
              </li>
            );
          },
        }}
      >
        {body || "*No description.*"}
      </Markdown>
      {image && /<(?:img|video|audio|iframe|details)\b/i.test(body) && (
        <p className="muted">
          Embedded HTML is available in the source service.{" "}
          <button
            type="button"
            className="markdown-link"
            onClick={() => onOpen(image.issue.url)}
          >
            View original content ↗
          </button>
        </p>
      )}
    </>
  );
}
