import { z } from "zod";
import {
  issueRefSchema,
  type SelectionAnnotationContext,
  type SharedIssueRef,
} from "../shared/contracts";
import { linearRefSchema } from "../shared/linear";
import { annotationSnapshotIdSchema } from "../shared/annotation-state";

const sharedContext = z.discriminatedUnion("source", [
  issueRefSchema
    .extend({
      source: z.literal("github"),
      arcoSharedIssue: z.literal(1),
    })
    .strip(),
  linearRefSchema
    .omit({ issueId: true })
    .extend({
      source: z.literal("linear"),
      id: linearRefSchema.shape.issueId,
      arcoSharedIssue: z.literal(1),
    })
    .strip(),
]);
const selection = z
  .object({
    text: z.string(),
    origin: z.enum(["body", "comment", "ui"]),
    commentId: z.string().optional(),
    comment: z.string().optional(),
  })
  .strict();
export const selectionIssueSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("github"),
    repo: issueRefSchema.shape.repo,
    number: issueRefSchema.shape.number,
    id: z.string().min(1),
    title: z.string(),
    url: z.string(),
    state: z.enum(["open", "closed"]),
  }),
  z.object({
    source: z.literal("linear"),
    connectionId: linearRefSchema.shape.connectionId,
    workspaceId: linearRefSchema.shape.workspaceId,
    teamId: linearRefSchema.shape.teamId,
    id: linearRefSchema.shape.issueId,
    identifier: z.string().min(1),
    title: z.string(),
    url: z.string(),
    state: z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      color: z.string(),
    }),
  }),
]);
const annotation = z
  .object({
    number: z.number().int().positive(),
    issue: selectionIssueSchema.optional(),
    selection,
  })
  .strict();
const annotationsContext = z.object({
  source: z.enum(["github", "linear", "arco"]),
  annotations: z
    .array(annotation)
    .refine(
      (items) =>
        new Set(items.map((item) => item.number)).size === items.length,
      "Annotation numbers must be unique.",
    ),
});

export interface SharedContextSnapshot {
  issue: SharedIssueRef | null;
  annotations: SelectionAnnotationContext[] | null;
  snapshotId: string | null;
}

// Parse the whole attachment once so navigation, annotations, and positions agree.
// A selection-only attachment is not a current Arco attachment format.
export function readSharedContext(value: unknown): SharedContextSnapshot {
  const empty = {
    issue: null,
    annotations: null,
    snapshotId: null,
  };
  if (!value || typeof value !== "object") return empty;
  let annotations: SelectionAnnotationContext[] | null = null;
  if (Object.hasOwn(value, "annotations")) {
    const parsed = annotationsContext.safeParse(value);
    if (!parsed.success) return empty;
    annotations = parsed.data.annotations;
  } else if (Object.hasOwn(value, "selection")) return empty;
  const ref = sharedContext.safeParse(value);
  if (!annotations && !ref.success) return empty;
  const data = ref.success ? ref.data : null;
  const issue =
    data && (!annotations || annotations.length === 1)
      ? data.source === "github"
        ? { source: data.source, repo: data.repo, number: data.number }
        : {
            source: data.source,
            connectionId: data.connectionId,
            workspaceId: data.workspaceId,
            teamId: data.teamId,
            issueId: data.id,
          }
      : null;
  const snapshot = z
    .object({ arcoAnnotationSnapshotId: annotationSnapshotIdSchema })
    .safeParse(value);
  return {
    issue,
    annotations,
    snapshotId:
      annotations?.length && snapshot.success
        ? snapshot.data.arcoAnnotationSnapshotId
        : null,
  };
}

const contentBlock = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    annotations: z
      .object({ audience: z.array(z.string()).optional() })
      .optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strip();

function annotationSnapshot(
  annotations: SelectionAnnotationContext[],
  value: unknown,
): SharedContextSnapshot {
  const issue = annotations.length === 1 ? annotations[0]!.issue : undefined;
  const snapshot = z
    .object({ arcoAnnotationSnapshotId: annotationSnapshotIdSchema })
    .safeParse(value);
  return {
    issue: issue
      ? issue.source === "github"
        ? { source: issue.source, repo: issue.repo, number: issue.number }
        : {
            source: issue.source,
            connectionId: issue.connectionId,
            workspaceId: issue.workspaceId,
            teamId: issue.teamId,
            issueId: issue.id,
          }
      : null,
    annotations,
    snapshotId:
      annotations.length && snapshot.success
        ? snapshot.data.arcoAnnotationSnapshotId
        : null,
  };
}

// Only removable visible blocks establish which annotations are still attached.
export function readModelContext(
  value: { content?: unknown; structuredContent?: unknown } | null | undefined,
): SharedContextSnapshot & { legacy: boolean } {
  const empty = { ...readSharedContext(undefined), legacy: false };
  if (!value) return empty;
  const structured = value.structuredContent;
  if (!structured || typeof structured !== "object") return empty;
  if (Object.hasOwn(structured, "arcoAnnotationFormat")) {
    const format = z
      .object({ source: z.literal("arco"), arcoAnnotationFormat: z.literal(2) })
      .safeParse(structured);
    if (!format.success) return empty;
    const annotations: SelectionAnnotationContext[] = [];
    for (const block of Array.isArray(value.content) ? value.content : []) {
      const parsed = contentBlock.safeParse(block);
      if (!parsed.success) continue;
      const audience = parsed.data.annotations?.audience;
      if (audience?.includes("assistant") && !audience.includes("user"))
        continue;
      const item = annotation.safeParse(parsed.data._meta?.["arco/annotation"]);
      if (!item.success) continue;
      if (annotations.some(({ number }) => number === item.data.number))
        return empty;
      annotations.push(item.data);
    }
    return { ...annotationSnapshot(annotations, structured), legacy: false };
  }
  if (Object.hasOwn(structured, "annotations")) {
    const previous = readSharedContext(structured);
    if (!previous.annotations || !Array.isArray(value.content)) return empty;
    const blocks = value.content;
    const annotations = previous.annotations.filter((item) => {
      const { number, issue, selection } = item;
      const identifier = issue
        ? issue.source === "github"
          ? `${issue.repo} #${issue.number}`
          : issue.identifier
        : "Arco";
      const preview = selection.text.replace(/\s+/g, " ").trim();
      const text = `${number}. ${identifier}\n${selection.text}${selection.comment ? `\n\nComment: ${selection.comment}` : ""}`;
      const title = `#${number} ${preview.length > 64 ? `${preview.slice(0, 64)}…` : preview}`;
      return blocks.some((block: unknown) => {
        const parsed = contentBlock.safeParse(block);
        if (!parsed.success || parsed.data.annotations?.audience?.length)
          return false;
        return (
          parsed.data.text === text &&
          parsed.data._meta?.["openai/title"] === title
        );
      });
    });
    return { ...annotationSnapshot(annotations, structured), legacy: true };
  }
  return { ...readSharedContext(structured), legacy: false };
}
