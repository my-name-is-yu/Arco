import { describe, expect, it } from "vitest";
import { matchesBulkOperation } from "../src/ui/github-bulk-recovery";

const sessionKey = 'github:bulk:["public:yu",["yu/arco#42","yu/arco#43"]]';

describe("GitHub bulk operation identity", () => {
  it("continues an unchanged pending operation after custom-field draft values are removed", () => {
    const current = JSON.stringify([sessionKey, "milestone", "2"]);
    const legacy = JSON.stringify([
      sessionKey,
      "milestone",
      "2",
      "101",
      "project-id",
      ["Frontend"],
      false,
    ]);
    expect(matchesBulkOperation(current, sessionKey, "milestone", "2")).toBe(
      true,
    );
    expect(matchesBulkOperation(legacy, sessionKey, "milestone", "2")).toBe(
      true,
    );
  });

  it.each([
    ["another account or selection", `${sessionKey}:other`, "milestone", "2"],
    ["another action", sessionKey, "issue-type", "2"],
    ["another value", sessionKey, "milestone", "1"],
  ])(
    "does not merge results for %s",
    (_reason, attemptSession, action, value) => {
      for (const parts of [
        [attemptSession, action, value],
        [attemptSession, action, value, "", "", null, false],
      ]) {
        expect(
          matchesBulkOperation(
            JSON.stringify(parts),
            sessionKey,
            "milestone",
            "2",
          ),
        ).toBe(false);
      }
    },
  );

  it("does not reinterpret a retired field operation as the empty action picker", () => {
    for (const action of ["issue-field", "project-field"]) {
      const legacy = JSON.stringify([
        sessionKey,
        action,
        "",
        "101",
        "project-id",
        "draft",
        true,
      ]);
      expect(matchesBulkOperation(legacy, sessionKey, "", "")).toBe(false);
      expect(matchesBulkOperation(legacy, sessionKey, "close", "")).toBe(false);
    }
  });

  it.each([
    "not json",
    "null",
    "{}",
    '"text"',
    "[]",
    JSON.stringify([sessionKey, "milestone"]),
    JSON.stringify([sessionKey, "milestone", "2", "unexpected"]),
    JSON.stringify([sessionKey, "milestone", 2]),
  ])("rejects an invalid identity without throwing: %s", (identity) => {
    expect(matchesBulkOperation(identity, sessionKey, "milestone", "2")).toBe(
      false,
    );
  });
});
