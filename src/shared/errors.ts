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

export class ToolCallError extends OperationError {
  constructor(
    readonly kind: OperationErrorKind,
    readonly detail: string,
  ) {
    super(detail, kind);
    this.name = "ToolCallError";
  }
}

export function readToolFailure(structuredContent: unknown): ToolCallError {
  const parsed = toolFailureSchema.safeParse(structuredContent);
  if (!parsed.success)
    return new ToolCallError(
      "invalid-response",
      "Could not read the result. Reopen Arco and try again.",
    );
  return new ToolCallError(parsed.data.error.kind, parsed.data.error.message);
}
