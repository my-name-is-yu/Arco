import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  OperationError,
  operationErrorKind,
  type OperationErrorKind,
} from "../shared/errors";

export function dataResult(
  value: object,
  content: "json" | "empty" = "json",
): CallToolResult {
  return {
    content:
      content === "empty"
        ? []
        : [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: { ...value },
  };
}

export function imageResult(image: object): CallToolResult {
  return {
    content: [{ type: "text", text: "Image loaded." }],
    _meta: { image },
  };
}

export function failureResult(
  error: unknown,
  fallback = "The operation failed.",
  kind: OperationErrorKind = "unavailable",
): CallToolResult {
  const failure =
    error instanceof OperationError
      ? { kind: operationErrorKind(error.code), message: error.message }
      : error instanceof z.ZodError
        ? {
            kind: "invalid-input" as const,
            message: "The supplied target or values are invalid.",
          }
        : { kind, message: fallback };
  return {
    isError: true,
    content: [{ type: "text", text: failure.message }],
    structuredContent: { error: failure },
  };
}
