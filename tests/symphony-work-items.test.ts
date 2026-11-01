import { expect, it } from "vitest";
import { createFixtureService } from "../src/server/fixture";
import {
  createSymphonyFixtureService,
  SYMPHONY_FIXTURE_CONNECTIONS,
} from "../src/server/symphony-fixture";
import {
  classifySymphonyWork,
  symphonyWorkItems,
} from "../src/ui/symphony-queries";

it("prioritizes observed runtime over overlapping native classification and retains unmatched work", async () => {
  const connection = SYMPHONY_FIXTURE_CONNECTIONS[0]!;
  const issue = await createFixtureService().get({
    repo: "yu/Arco",
    number: 42,
  });
  const snapshot = await createSymphonyFixtureService().getState({
    connectionId: connection.id,
  });
  const running = snapshot.rows.find((row) => row.issueIdentifier === "GH-42")!;
  expect(classifySymphonyWork(running, issue, connection.binding)).toBe(
    "working",
  );
  expect(
    classifySymphonyWork(
      { ...running, runtimeStatus: "blocked" },
      issue,
      connection.binding,
    ),
  ).toBe("attention");
  expect(classifySymphonyWork(null, issue, connection.binding)).toBe(
    "attention",
  );
  expect(
    classifySymphonyWork(null, issue, {
      source: "github",
      repo: "yu/Arco",
      prepareLabels: ["design"],
      reviewLabels: [],
    }),
  ).toBe("preparation");
  expect(classifySymphonyWork(null, issue, undefined)).toBe("other");

  const work = symphonyWorkItems(connection, snapshot.rows, [issue]);
  expect(work.filter((item) => item.identifier === "GH-42")).toHaveLength(1);
  expect(work.find((item) => item.identifier === "GH-999")).toMatchObject({
    issue: null,
    group: "attention",
  });
  const nativeOnly = symphonyWorkItems(connection, [], [issue]);
  expect(nativeOnly).toEqual([
    expect.objectContaining({ runtime: null, group: "attention", issue }),
  ]);
});
