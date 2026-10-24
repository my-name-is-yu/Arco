import { z } from "zod";
import { issueRefSchema, repoSchema } from "./contracts";
import { linearRefSchema } from "./linear";

const githubIssueTargetSchema = issueRefSchema
  .extend({ source: z.literal("github") })
  .strict();
const linearIssueTargetSchema = linearRefSchema
  .extend({ source: z.literal("linear") })
  .strict();
export const nativeIssueTargetSchema = z.discriminatedUnion("source", [
  githubIssueTargetSchema,
  linearIssueTargetSchema,
]);

export type NativeIssueTarget = z.infer<typeof nativeIssueTargetSchema>;

const presentationFields = {
  title: z.string().min(1).max(1024),
  url: z.url(),
};
export const issuePresentationSummarySchema = z.discriminatedUnion("source", [
  githubIssueTargetSchema.extend({
    ...presentationFields,
    id: z.string().min(1),
    state: z.enum(["open", "closed"]),
    stateReason: z.string().nullable(),
  }),
  linearIssueTargetSchema.extend({
    ...presentationFields,
    identifier: z.string().min(1).max(200),
    state: z
      .object({
        id: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        type: z.string().max(200),
        color: z.string().max(200),
      })
      .strict(),
  }),
]);
export type IssuePresentationSummary = z.infer<
  typeof issuePresentationSummarySchema
>;

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
    issues: z.array(issuePresentationSummarySchema).min(2).max(10).optional(),
    source: z.enum(["github", "linear"]).optional(),
  })
  .strict()
  .refine((launch) => !launch.target || !launch.issues, {
    message: "Choose one issue or an issue list.",
    path: ["issues"],
  });

export type LaunchContext = z.infer<typeof launchContextSchema>;

export const personalLaunchContext: LaunchContext = {
  view: "personal",
  repo: null,
  projectKey: null,
  projectName: null,
  candidates: [],
  reason: "personal",
};
