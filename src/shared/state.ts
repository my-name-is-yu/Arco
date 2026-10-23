import { z } from "zod";
import { accountIssueFilterSchema, repoSchema } from "./contracts";

export const githubAccountFilterSchema = z
  .object({
    filter: accountIssueFilterSchema,
    state: z.enum(["open", "closed", "all"]),
    sort: z.enum(["updated", "created", "comments"]),
    order: z.enum(["asc", "desc"]),
  })
  .strict();
const defaultGithubAccountFilter = {
  filter: "assigned" as const,
  state: "open" as const,
  sort: "updated" as const,
  order: "desc" as const,
};
export const settingsSchema = z
  .object({
    githubRepos: z.array(repoSchema).max(100),
    activeGithubRepo: repoSchema.nullable(),
    githubAccountFilter: githubAccountFilterSchema,
    activeSource: z.enum(["github", "linear"]),
    linearTeams: z
      .array(
        z.object({
          workspaceId: z.string().min(1),
          teamId: z.string().min(1),
          name: z.string().min(1),
        }),
      )
      .max(100),
    activeLinearTeam: z.string().nullable(),
    githubFilters: z
      .record(
        repoSchema,
        z
          .object({
            query: z.string().max(500),
            state: z.enum(["open", "closed", "all"]),
            sort: z.enum(["updated", "created", "comments"]),
            order: z.enum(["asc", "desc"]),
          })
          .strict(),
      )
      .refine((value) => Object.keys(value).length <= 100),
    linearFilters: z
      .record(
        z.string().min(1).max(600),
        z
          .object({
            query: z.string().max(500),
            stateId: z.string().max(200),
            assigneeId: z.string().max(200),
            labelId: z.string().max(200),
            projectId: z.string().max(200),
            order: z.enum(["updatedAt", "createdAt"]),
          })
          .strict(),
      )
      .refine((value) => Object.keys(value).length <= 100),
  })
  .strict();
export const settingsRecordSchema = z.object({
  revision: z.number().int().nonnegative(),
  settings: settingsSchema.extend({
    githubFilters: settingsSchema.shape.githubFilters.default({}),
    linearFilters: settingsSchema.shape.linearFilters.default({}),
    githubAccountFilter: githubAccountFilterSchema
      .extend({ filter: accountIssueFilterSchema.default("assigned") })
      .default(defaultGithubAccountFilter),
  }),
});
export const settingsUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    patch: settingsSchema.partial(),
  })
  .strict();
export const draftKeySchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("github"),
      repo: repoSchema,
      issue: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      source: z.literal("linear"),
      workspaceId: z.string().min(1).max(100),
      teamId: z.string().min(1).max(100),
      issue: z.string().min(1).max(100),
    })
    .strict(),
]);
export const draftSchema = z
  .object({
    title: z.string().max(256),
    body: z.string().max(65536),
    comment: z.string().max(65536),
    githubLabels: z.array(z.string().min(1).max(100)).max(100).optional(),
    githubAssignees: z.array(z.string().min(1).max(100)).max(100).optional(),
    githubChildRepo: z.string().max(201).optional(),
    githubIssueTypeName: z.string().min(1).max(256).optional(),
    linearTemplateId: z.string().min(1).max(200).optional(),
    linearDescriptionTouched: z.boolean().optional(),
    linearReplyTo: z.string().min(1).max(200).optional(),
    promptText: z.string().max(65536).optional(),
    // Accept earlier saved drafts; request sending no longer uses this value.
    promptTarget: z.enum(["self", "new"]).optional(),
    baseTitle: z.string().max(256).optional(),
    baseBody: z.string().max(65536).optional(),
    baseUpdatedAt: z.string().optional(),
  })
  .strict();
export const draftRecordSchema = z.object({
  revision: z.number().int().nonnegative(),
  draft: draftSchema.nullable(),
});
export const draftReadSchema = z.object({ key: draftKeySchema }).strict();
export const draftWriteSchema = draftReadSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  draft: draftSchema,
});
export const draftDeleteSchema = draftReadSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsRecord = z.infer<typeof settingsRecordSchema>;
export type DraftKey = z.infer<typeof draftKeySchema>;
export type Draft = z.infer<typeof draftSchema>;
export type DraftRecord = z.infer<typeof draftRecordSchema>;
export const defaultSettings: Settings = {
  githubRepos: [],
  activeGithubRepo: null,
  githubAccountFilter: defaultGithubAccountFilter,
  activeSource: "github",
  linearTeams: [],
  activeLinearTeam: null,
  githubFilters: {},
  linearFilters: {},
};
