import { z } from "zod";
import { issueRefSchema, repoSchema } from "./contracts";
import { linearRefSchema } from "./linear";

export const nativeIssueTargetSchema = z.discriminatedUnion("source", [
  issueRefSchema.extend({ source: z.literal("github") }).strict(),
  linearRefSchema.extend({ source: z.literal("linear") }).strict(),
]);

export type NativeIssueTarget = z.infer<typeof nativeIssueTargetSchema>;

export const launchContextSchema = z
  .object({
    view: z.enum(["personal", "project"]),
    repo: repoSchema.nullable(),
    projectKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    projectName: z.string().min(1).max(256).nullable(),
    candidates: z.array(repoSchema).max(100),
    reason: z.enum([
      "personal",
      "detected",
      "unavailable",
      "ambiguous",
      "no-github-repository",
    ]),
    target: nativeIssueTargetSchema.optional(),
    source: z.enum(["github", "linear"]).optional(),
  })
  .strict();

export type LaunchContext = z.infer<typeof launchContextSchema>;

export const personalLaunchContext: LaunchContext = {
  view: "personal",
  repo: null,
  projectKey: null,
  projectName: null,
  candidates: [],
  reason: "personal",
};
