import { z } from "zod";
import { repoSchema } from "./contracts";

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
