import { describe, expect, it } from "vitest";
import { z } from "zod";
import { linearSchemas } from "../src/shared/linear";

describe("bounded collection validation", () => {
  it.each([false, true])(
    "rejects oversized invalid collections before validating elements (jitless=%s)",
    (jitless) => {
      z.config({ jitless });
      try {
        const scope = {
          connectionId: "connection",
          workspaceId: "workspace",
          teamId: "team",
          requestId: "request",
        };
        expect(
          linearSchemas.linear_bulk.safeParse({ ...scope, issueIds: ["issue"] })
            .success,
        ).toBe(true);
        const result = linearSchemas.linear_bulk.safeParse({
          ...scope,
          issueIds: Array(10000).fill(42),
        });
        expect(result.success).toBe(false);
        if (result.success)
          throw new Error("Expected an oversized collection.");
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0]).toMatchObject({
          code: "too_big",
          path: ["issueIds"],
        });
      } finally {
        z.config({ jitless: false });
      }
    },
  );
});
