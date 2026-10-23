import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const path = z.array(z.number().int().nonnegative()).max(64);
const offset = z.number().int().nonnegative();
const point = z.object({ path, offset }).strict();
export const persistedSelectionAnchorSchema = z
  .object({
    rootKind: z.enum([".issue-row", ".detail-pane", ".inline-mode", ".arco"]),
    issueKey: z.string().min(1).max(2000),
    rootHash: hash.optional(),
    selectionHash: hash,
    target: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("range"),
          start: point,
          end: point,
          sourceHash: hash,
        })
        .strict(),
      z
        .object({
          kind: z.literal("editable"),
          path,
          signature: z.string().max(2000),
          start: offset,
          end: offset,
          valueHash: hash,
        })
        .strict(),
    ]),
  })
  .strict()
  .refine(
    (anchor) => anchor.rootKind !== ".arco" || anchor.rootHash !== undefined,
  );
export type PersistedSelectionAnchor = z.infer<
  typeof persistedSelectionAnchorSchema
>;
export const annotationSnapshotIdSchema = z.uuid();
export const annotationSnapshotKeySchema = z
  .object({ id: annotationSnapshotIdSchema })
  .strict();
export const annotationSnapshotSchema = annotationSnapshotKeySchema.extend({
  anchors: z
    .array(
      z
        .object({
          number: z.number().int().positive(),
          contextHash: hash,
          anchor: persistedSelectionAnchorSchema,
        })
        .strict(),
    )
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => item.number)).size === items.length,
    ),
});
export type AnnotationSnapshot = z.infer<typeof annotationSnapshotSchema>;
