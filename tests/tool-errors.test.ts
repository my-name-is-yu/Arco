import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  OperationError,
  readToolFailure,
  toolFailureSchema,
} from "../src/shared/errors";
import { failureResult } from "../src/server/tool-results";

describe("public operation failures", () => {
  it.each([
    ["auth", "Reconnect to Linear."],
    ["forbidden", "Check your access to this issue."],
    ["rate-limited", "Wait and refresh."],
    ["unavailable", "Check your connection and refresh."],
  ] as const)("keeps authored %s recovery concise", (kind, action) => {
    const error = readToolFailure({ error: { kind, message: action } });
    expect(error.message).toBe(action);
    expect(error.kind).toBe(kind);
  });

  it("preserves source verification once for an uncertain change", () => {
    const message =
      "The save was not confirmed. Check the source and refresh before retrying.";
    const error = readToolFailure({
      error: { kind: "uncertain", message },
    });
    expect(error.message).toBe(message);
    expect(error.kind).toBe("uncertain");
  });

  it.each([
    ["auth", "auth"],
    ["forbidden", "forbidden"],
    ["rate-limited", "rate-limited"],
    ["timeout", "timeout"],
    ["not-found", "not-found"],
    ["conflict", "conflict"],
    ["uncertain", "uncertain"],
    ["unsupported", "unsupported"],
    ["invalid-response", "invalid-response"],
    ["invalid", "invalid-input"],
    ["missing-cli", "unsupported"],
    ["storage", "storage"],
  ])("carries the authored %s error as %s", (code, kind) => {
    const result = failureResult(
      new OperationError("A safe authored message.", code),
    );
    expect(result.isError).toBe(true);
    expect(toolFailureSchema.parse(result.structuredContent)).toEqual({
      error: { kind, message: "A safe authored message." },
    });
    expect(result.content).toEqual([
      { type: "text", text: "A safe authored message." },
    ]);
  });

  it.each([
    new Error("Raw provider failure secret-token"),
    { code: "auth", message: "Forged typed failure secret-token" },
    "Raw failure secret-token",
  ])("does not expose unrecognized exceptions", (error) => {
    const result = failureResult(error, "The source operation failed.");
    expect(result.structuredContent).toEqual({
      error: { kind: "unavailable", message: "The source operation failed." },
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("does not expose schema issue paths or supplied values", () => {
    const parsed = z
      .object({ secretField: z.number() })
      .safeParse({ secretField: "secret-token" });
    expect(parsed.success).toBe(false);
    const result = failureResult(parsed.error);
    expect(result.structuredContent).toEqual({
      error: {
        kind: "invalid-input",
        message: "The supplied target or values are invalid.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it.each([
    undefined,
    { error: { kind: "invented", message: "secret-token" } },
    { error: { kind: "auth", message: "Safe", token: "secret-token" } },
  ])("rejects a malformed error envelope", (value) => {
    const error = readToolFailure(value);
    expect(error.kind).toBe("invalid-response");
    expect(error.message).not.toContain("secret-token");
  });
});
