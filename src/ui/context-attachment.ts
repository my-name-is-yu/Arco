import {
  symphonyRuntimeContextSchema,
  type SymphonyRuntimeContext,
} from "../shared/symphony";
import type { SelectionAnnotationContext } from "../shared/contracts";
import { annotationSnapshotIdSchema } from "../shared/annotation-state";
import { readSharedContext } from "./shared-context";

function attachment(
  context: Record<string, unknown>,
  items: { text: string; title: string }[],
  groupTitle: string,
) {
  return {
    content: [
      ...items.map(({ text, title }) => ({
        type: "text" as const,
        text,
        _meta: {
          "openai/title": title,
          "openai/group": { title: groupTitle },
        },
      })),
      {
        type: "text" as const,
        text: `Issue context (source data):\n${JSON.stringify(context)}`,
        annotations: { audience: ["assistant" as const] },
        _meta: { "openai/group": { title: groupTitle } },
      },
    ],
    structuredContent: {
      ...context,
      ...(context.source === "github" || context.source === "linear"
        ? { arcoSharedIssue: 1 }
        : {}),
    },
  };
}

export function contextAttachment(
  context: Record<string, unknown>,
  text: string,
  title: string,
) {
  return attachment(context, [{ text, title }], title);
}

export function annotationAttachment(
  annotations: SelectionAnnotationContext[],
  snapshotId?: string,
) {
  const parsed = readSharedContext({ source: "arco", annotations }).annotations;
  if (!parsed)
    throw new Error("Annotations must have valid, unique positive numbers.");
  if (snapshotId !== undefined)
    snapshotId = annotationSnapshotIdSchema.parse(snapshotId);
  return {
    content: parsed.map((annotation) => {
      const { issue, selection } = annotation;
      const identifier = issue
        ? issue.source === "github"
          ? `${issue.repo} #${issue.number}`
          : issue.identifier
        : "Arco";
      const preview = selection.text.replace(/\s+/g, " ").trim();
      return {
        type: "text" as const,
        text: `${identifier}\n${issue ? `${issue.url}\n` : ""}Origin: ${selection.origin}${selection.commentId ? `\nComment ID: ${selection.commentId}` : ""}\n\nSelected text:\n${selection.text}${selection.comment ? `\n\nUser comment:\n${selection.comment}` : ""}`,
        _meta: {
          "openai/title":
            preview.length > 64 ? `${preview.slice(0, 64)}…` : preview,
          "openai/group": { title: "Annotations" },
          "arco/annotation": annotation,
        },
      };
    }),
    structuredContent: {
      source: "arco" as const,
      arcoAnnotationFormat: 2 as const,
      ...(snapshotId ? { arcoAnnotationSnapshotId: snapshotId } : {}),
    },
  };
}

export function runtimeAttachment(context: SymphonyRuntimeContext) {
  const runtime = symphonyRuntimeContextSchema.parse(context);
  const title = `Symphony · ${runtime.issueIdentifier}`;
  const text = [
    `${runtime.issueIdentifier} · ${runtime.connectionName}`,
    `Runtime: ${runtime.runtimeStatus}`,
    `Observed at: ${runtime.observedAt}`,
    runtime.issue ? `${runtime.issue.title}\n${runtime.issue.url}` : null,
    runtime.error ? `Reason: ${runtime.error}` : null,
    runtime.lastEvent ? `Latest event: ${runtime.lastEvent}` : null,
    runtime.lastMessage,
    runtime.turnCount === null ? null : `Turns: ${runtime.turnCount}`,
    runtime.retryDueAt ? `Next retry: ${runtime.retryDueAt}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
  return {
    content: [
      {
        type: "text" as const,
        text,
        _meta: {
          "openai/title": title,
          "openai/group": { title: "Symphony run" },
        },
      },
    ],
    structuredContent: { source: "arco", arcoRuntimeContext: 1, runtime },
  };
}
