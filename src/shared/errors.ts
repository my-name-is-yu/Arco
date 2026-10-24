import { z } from "zod";

export const operationErrorKindSchema = z.enum([
  "auth",
  "forbidden",
  "rate-limited",
  "timeout",
  "unavailable",
  "not-found",
  "conflict",
  "uncertain",
  "unsupported",
  "invalid-response",
  "invalid-input",
  "storage",
]);
export type OperationErrorKind = z.infer<typeof operationErrorKindSchema>;

export const toolFailureSchema = z
  .object({
    error: z
      .object({
        kind: operationErrorKindSchema,
        message: z.string().min(1).max(2000),
      })
      .strict(),
  })
  .strict();

/** An authored, safe message that may cross the server boundary. */
export class OperationError extends Error {
  constructor(
    message: string,
    readonly code: string = "unavailable",
  ) {
    super(message);
    this.name = "OperationError";
  }
}

export function operationErrorKind(code: string): OperationErrorKind {
  if (code === "invalid") return "invalid-input";
  if (code === "missing-cli") return "unsupported";
  const parsed = operationErrorKindSchema.safeParse(code);
  return parsed.success ? parsed.data : "unavailable";
}

const nextAction: Record<OperationErrorKind, string> = {
  auth: "Reconnect the source account, then refresh.",
  forbidden: "Check your access to this target and the account's permissions.",
  "rate-limited": "Wait for the source's API limit to reset, then refresh.",
  timeout:
    "Check the connection and refresh. Confirm any change in the source before retrying it.",
  unavailable:
    "Check the connection and refresh. Confirm any change in the source before retrying it.",
  "not-found": "Check the source link and selected account or scope.",
  conflict:
    "Review the latest saved version before submitting your change again.",
  uncertain:
    "Check the result in the source and refresh before submitting this change again.",
  unsupported:
    "Use the source application for this operation or update the required component.",
  "invalid-response":
    "Refresh to read the source again. If this continues, report the error.",
  "invalid-input": "Review the selected target and the values you entered.",
  storage:
    "Keep your input. Check Arco's local data and storage access before trying to save again.",
};

export class ToolCallError extends OperationError {
  constructor(
    readonly kind: OperationErrorKind,
    readonly detail: string,
  ) {
    super(`${detail} ${nextAction[kind]}`, kind);
    this.name = "ToolCallError";
  }
}

export function readToolFailure(structuredContent: unknown): ToolCallError {
  const parsed = toolFailureSchema.safeParse(structuredContent);
  if (!parsed.success)
    return new ToolCallError(
      "invalid-response",
      "The server returned an invalid error response.",
    );
  return new ToolCallError(parsed.data.error.kind, parsed.data.error.message);
}
