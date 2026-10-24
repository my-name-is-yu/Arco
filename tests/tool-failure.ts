import type { OperationErrorKind } from "../src/shared/errors";

export function toolFailure(
  message: string,
  kind: OperationErrorKind = "unavailable",
) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
    structuredContent: { error: { kind, message } },
  };
}
