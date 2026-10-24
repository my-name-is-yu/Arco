import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ComponentProps,
} from "react";
import { Markdown } from "@openai/apps-sdk-ui/components/Markdown";
import { useQuery } from "@tanstack/react-query";
import rehypeSanitize from "rehype-sanitize";
import type { ArcoHost, ConversationIssue } from "../shared/contracts";
import { markdownTasks, type MarkdownTask } from "./markdown-tasks";
import { useNearViewport } from "./useNearViewport";
import {
  safeMarkdownUrl,
  sourceImageQueryOptions,
} from "./presentation-images";

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
  const { ref, near } = useNearViewport<HTMLSpanElement>();
  const preview = useQuery({
    ...sourceImageQueryOptions(
      image?.host,
      image?.issue,
      url,
      image?.commentId,
    ),
    enabled: Boolean(image) && near,
  });
  return (
    <span className="source-image" ref={ref}>
      {preview.data && (
        <img
          src={`data:${preview.data.mimeType};base64,${preview.data.data}`}
          alt={alt}
          loading="lazy"
        />
      )}
      {image && !preview.data && !preview.isError && (
        <span className="muted source-image-placeholder">
          {near ? `Loading ${alt}…` : alt}{" "}
        </span>
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
function normalizeMarkdownProperties() {
  return (tree: Parameters<ReturnType<typeof rehypeSanitize>>[0]) => {
    function visit(node: typeof tree | (typeof tree.children)[number]) {
      if (node.type === "element") {
        const classes: unknown = node.properties.className;
        // Directive attributes are strings, unlike Markdown's class arrays.
        // Validate each class separately so a language prefix cannot hide extras.
        if (typeof classes === "string")
          node.properties.className = classes.split(/\s+/).filter(Boolean);
        if (node.tagName === "a" || node.tagName === "img") {
          const key = node.tagName === "a" ? "href" : "src";
          const value = node.properties[key];
          if (typeof value === "string") {
            const url = safeMarkdownUrl(value);
            if (url) node.properties[key] = url;
          }
        }
      }
      if ("children" in node) node.children.forEach(visit);
    }
    visit(tree);
  };
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

type MarkdownContextValue = {
  body: string;
  onOpen: (url: string) => void;
  onToggleTask?: (line: number, checked: boolean) => void;
  busy?: boolean;
  image?: ImageContext;
};
const MarkdownContext = createContext<
  | (MarkdownContextValue & {
      tasks: ReadonlyMap<number, MarkdownTask>;
    })
  | null
>(null);

// Renderer identities must stay stable: remounting an image aborts its query.
const markdownComponents: NonNullable<
  ComponentProps<typeof Markdown>["components"]
> = {
  a: function MarkdownLink({ node, children }) {
    const { onOpen } = useContext(MarkdownContext)!;
    const url = safeMarkdownUrl(property(node, "href"));
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
  img: function MarkdownImage({ node }) {
    const { image, onOpen } = useContext(MarkdownContext)!;
    const url = safeMarkdownUrl(property(node, "src"));
    const alt = property(node, "alt") || "Attached image";
    return url ? (
      <SourceImage url={url} alt={alt} image={image} onOpen={onOpen} />
    ) : (
      <span>{alt}</span>
    );
  },
  li: function MarkdownListItem({ node, children, className }) {
    const { tasks, busy, onToggleTask } = useContext(MarkdownContext)!;
    const line = linePosition(node);
    const task = line ? tasks.get(line) : null;
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
};

export function IssueMarkdown({
  body,
  onOpen,
  onToggleTask,
  busy = false,
  image,
}: MarkdownContextValue) {
  const tasks = useMemo(() => markdownTasks(body), [body]);
  return (
    <MarkdownContext value={{ body, onOpen, onToggleTask, busy, image, tasks }}>
      <Markdown
        className="issue-markdown"
        includeMath={false}
        skipHtml
        // Directives also create HTML nodes; keep provider content from creating
        // active elements or the data attributes used for selection provenance.
        rehypePlugins={[normalizeMarkdownProperties, rehypeSanitize]}
        components={markdownComponents}
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
    </MarkdownContext>
  );
}
