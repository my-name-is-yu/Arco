import { z } from "zod";
import {
  fieldValueSchema,
  type FieldValue,
} from "../../shared/github-operations";
import { invalid } from "./operations-context";
export function fieldValue(raw: unknown): FieldValue {
  const parsed = fieldValueSchema.safeParse(raw);
  return parsed.success ? parsed.data : (JSON.stringify(raw) ?? null);
}

export function checkFieldValue(
  type: string,
  value: FieldValue,
  options: string[],
  iterations: string[] = [],
) {
  if (value === null) return;
  if (type === "text" && typeof value === "string") return;
  if (type === "number" && typeof value === "number" && Number.isFinite(value))
    return;
  if (
    type === "date" &&
    typeof value === "string" &&
    z.iso.date().safeParse(value).success
  )
    return;
  if (
    type === "single_select" &&
    typeof value === "string" &&
    options.includes(value)
  )
    return;
  if (
    type === "multi_select" &&
    Array.isArray(value) &&
    value.every((name) => options.includes(name))
  )
    return;
  if (
    type === "iteration" &&
    typeof value === "string" &&
    iterations.includes(value)
  )
    return;
  invalid(
    "The value does not match the field type, existing options, or iteration.",
  );
}
