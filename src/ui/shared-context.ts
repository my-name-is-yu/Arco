import { z } from "zod";
import {
  issueRefSchema,
  type SelectionAnnotationContext,
  type SharedIssueRef,
} from "../shared/contracts";
import { linearRefSchema } from "../shared/linear";
import { annotationSnapshotIdSchema } from "../shared/annotation-state";

export function annotationSnapshotIdFromContext(value: unknown): string | null {
  const result = z
    .object({ arcoAnnotationSnapshotId: annotationSnapshotIdSchema })
    .safeParse(value);
  return result.success ? result.data.arcoAnnotationSnapshotId : null;
}

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
const selectionContext = z.object({
  source: z.enum(["github", "linear", "arco"]),
  selection,
});
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

// Read only our structured app snapshot; display text is never a navigation target.
export function sharedRefFromContext(value: unknown): SharedIssueRef | null {
  const result = sharedContext.safeParse(value);
  if (!result.success) return null;
  const data = result.data;
  return data.source === "github"
    ? { source: "github", repo: data.repo, number: data.number }
    : {
        source: "linear",
        connectionId: data.connectionId,
        workspaceId: data.workspaceId,
        teamId: data.teamId,
        issueId: data.id,
      };
}

export function sharedAnnotationsFromContext(
  value: unknown,
): SelectionAnnotationContext[] | null {
  if (
    value &&
    typeof value === "object" &&
    Object.hasOwn(value, "annotations")
  ) {
    const result = annotationsContext.safeParse(value);
    return result.success ? result.data.annotations : null;
  }
  const result = selectionContext.safeParse(value);
  if (!result.success) return null;
  if (result.data.source === "arco")
    return [{ number: 1, selection: result.data.selection }];
  if (!sharedContext.safeParse(value).success) return null;
  const issue = selectionIssueSchema.safeParse(value);
  return issue.success
    ? [{ number: 1, issue: issue.data, selection: result.data.selection }]
    : null;
}
