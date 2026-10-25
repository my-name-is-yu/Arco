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
const annotationsContext = z.object({
  source: z.enum(["github", "linear", "arco"]),
  annotations: z
    .array(
      z
        .object({
          number: z.number().int().positive(),
          issue: selectionIssueSchema.optional(),
          selection,
        })
        .strict(),
    )
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
