import { describe, expect, it } from "vitest";
import { sharedRefFromContext } from "../src/ui/shared-context";

describe("restoring shared app context", () => {
  it("restores only native refs from marked structured context", () => {
    expect(
      sharedRefFromContext({
        arcoSharedIssue: 1,
        source: "github",
        repo: "yu/Arco",
        number: 43,
        body: "not retained",
      }),
    ).toEqual({ source: "github", repo: "yu/Arco", number: 43 });
    expect(
      sharedRefFromContext({
        arcoSharedIssue: 1,
        source: "linear",
        connectionId: "default",
        workspaceId: "workspace",
        teamId: "team",
        id: "native-issue",
        body: "not retained",
      }),
    ).toEqual({
      source: "linear",
      connectionId: "default",
      workspaceId: "workspace",
      teamId: "team",
      issueId: "native-issue",
    });
  });
  it("does not navigate from text, unmarked app data, malformed refs or unknown versions", () => {
    for (const value of [
      "yu/Arco #43",
      null,
      { source: "github", repo: "yu/Arco", number: 43 },
      { arcoSharedIssue: 1, source: "github", repo: "../Arco", number: 43 },
      { arcoSharedIssue: 1, source: "github", repo: "yu/Arco", number: -1 },
      { arcoSharedIssue: 2, source: "github", repo: "yu/Arco", number: 43 },
      {
        arcoSharedIssue: 1,
        source: "linear",
        id: "native-issue",
        connectionId: "default",
        workspaceId: "workspace",
      },
    ])
      expect(sharedRefFromContext(value)).toBeNull();
  });
});
