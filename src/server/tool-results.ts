import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
): CallToolResult {
  return {
    isError: true,
    content: [
      { type: "text", text: error instanceof Error ? error.message : fallback },
    ],
  };
}
