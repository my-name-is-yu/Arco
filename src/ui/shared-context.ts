import { z } from "zod";
import { issueRefSchema, type SharedIssueRef } from "../shared/contracts";
import { linearRefSchema } from "../shared/linear";

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
