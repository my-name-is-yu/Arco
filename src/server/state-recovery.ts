import { z } from "zod";
import {
  defaultSettings,
  draftRecordSchema,
  draftSchema,
  githubAccountFilterSchema,
  settingsRecordSchema,
  settingsSchema,
} from "../shared/state";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recoverFields(
  shape: Record<string, z.ZodType>,
  value: unknown,
  defaults: Record<string, unknown>,
) {
  const source = object(value);
  const recovered = { ...defaults };
  for (const [key, schema] of Object.entries(shape)) {
    const result = schema.safeParse(source[key]);
    if (result.success) recovered[key] = result.data;
  }
  return recovered;
}

function recoverCollection(schema: z.ZodType, value: unknown, array: boolean) {
  if (array)
    return (Array.isArray(value) ? value : [])
      .filter((item) => schema.safeParse([item]).success)
      .slice(0, 100);
  return Object.fromEntries(
    Object.entries(object(value))
      .filter(([key, item]) => schema.safeParse({ [key]: item }).success)
      .slice(-100),
  );
}

function nextRevision(value: unknown) {
  const result = settingsRecordSchema.shape.revision.safeParse(value);
  return result.success ? result.data + 1 : 1;
}

export function recoverSettings(value: unknown) {
  const record = object(value);
  const source = object(record.settings);
  const settings = recoverFields(settingsSchema.shape, source, defaultSettings);
  settings.githubAccountFilter = recoverFields(
    githubAccountFilterSchema.shape,
    source.githubAccountFilter,
    defaultSettings.githubAccountFilter,
  );
  for (const key of [
    "githubRepos",
    "linearTeams",
    "projectGithubRepos",
    "githubFilters",
    "linearFilters",
  ] as const) {
    const schema = settingsSchema.shape[key];
    if (!schema.safeParse(source[key]).success)
      settings[key] = recoverCollection(
        schema,
        source[key],
        Array.isArray(defaultSettings[key]),
      );
  }
  return settingsRecordSchema.parse({
    revision: nextRevision(record.revision),
    settings,
  });
}

export function recoverDraft(value: unknown) {
  const record = object(value);
  const draft = record.draft;
  return draftRecordSchema.parse({
    revision: nextRevision(record.revision),
    draft:
      draft !== null && typeof draft === "object" && !Array.isArray(draft)
        ? recoverFields(draftSchema.shape, draft, {
            title: "",
            body: "",
            comment: "",
          })
        : null,
  });
}
