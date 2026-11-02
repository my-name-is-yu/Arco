import { expect, it, vi } from "vitest";
import { createFixtureService } from "../src/server/fixture";
import {
  createLinearFixtureService,
  LINEAR_FIXTURE_SCOPE,
} from "../src/server/linear/fixture";
import type { LinearIssue } from "../src/shared/linear";
import { symphonyIssueMatches } from "../src/shared/symphony";
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

it("preserves scoped GitHub URL and dispatch matching, first matches and native order", async () => {
  const connection = SYMPHONY_FIXTURE_CONNECTIONS[0]!;
  const issue = await createFixtureService().get({
    repo: "yu/Arco",
    number: 42,
  });
  const snapshot = await createSymphonyFixtureService().getState({
    connectionId: connection.id,
  });
  const row = snapshot.rows[0]!;
  const foreign = { ...issue, repo: "other/project" };
  const invalid = { ...issue, url: "https://github.com:444/yu/Arco/issues/42" };
  const duplicate = { ...issue, title: "Later duplicate" };
  const unmatched = {
    ...issue,
    number: 43,
    url: "https://github.com/yu/Arco/issues/43",
  };
  const issues = [foreign, invalid, issue, duplicate, unmatched];
  const rows = [
    {
      ...row,
      issueUrl: "https://GITHUB.com/YU/ARCO/issues/42/?from=test#details",
    },
    { ...row, issueUrl: null, issueIdentifier: "wrong" },
    { ...row, issueUrl: null },
    { ...row, issueUrl: invalid.url },
    { ...row, issueUrl: "https://github.com/other/project/issues/42" },
    { ...row, issueUrl: null, issueId: "999", issueIdentifier: "GH-999" },
    { ...row, issueUrl: "" },
  ];
  const work = symphonyWorkItems(connection, rows, issues);
  expect(work.slice(rows.length).map((item) => item.issue)).toEqual([
    unmatched,
  ]);
  expect(work.slice(0, rows.length).map((item) => item.issue)).toEqual(
    rows.map(
      (runtime) =>
        issues.find((candidate) =>
          symphonyIssueMatches(connection.binding, runtime, candidate),
        ) ?? null,
    ),
  );
  expect(
    symphonyWorkItems({ ...connection, binding: undefined }, rows, issues)
      .slice(0, rows.length)
      .every((item) => item.issue === null),
  ).toBe(true);
});

it("preserves Linear scope, project, URL precedence and issue-ID fallback", async () => {
  const original = SYMPHONY_FIXTURE_CONNECTIONS[1]!;
  if (original.binding?.source !== "linear")
    throw new Error("Expected Linear binding");
  const connection = {
    ...original,
    binding: { ...original.binding, projectId: "linear-project" },
  };
  const issue = (await createLinearFixtureService().call("linear_get_issue", {
    ...LINEAR_FIXTURE_SCOPE,
    issueId: "fixture-linear-42",
  })) as LinearIssue;
  const snapshot = await createSymphonyFixtureService().getState({
    connectionId: connection.id,
  });
  const row = snapshot.rows[0]!;
  const invalid = { ...issue, url: "not-a-url" };
  const foreign = ["connectionId", "workspaceId", "teamId"].map((field) => ({
    ...issue,
    [field]: "foreign",
  }));
  const otherProject = { ...issue, project: { id: "other", name: "Other" } };
  const duplicate = {
    ...issue,
    issueId: "different-id",
    title: "Later URL match",
  };
  const issues = [...foreign, otherProject, invalid, issue, duplicate];
  const rows = [
    {
      ...row,
      issueUrl:
        "https://linear.app/FIXTURE/issue/yu-42/renamed-title?from=test#details",
    },
    { ...row, issueUrl: null, issueIdentifier: "arbitrary" },
    { ...row, issueUrl: "https://linear.app/other/issue/YU-42" },
    { ...row, issueUrl: "not-a-url" },
    { ...row, issueUrl: null, issueId: "unknown" },
    { ...row, issueUrl: "" },
  ];
  const work = symphonyWorkItems(connection, rows, issues);
  expect(work.slice(0, rows.length).map((item) => item.issue)).toEqual(
    rows.map(
      (runtime) =>
        issues.find((candidate) =>
          symphonyIssueMatches(connection.binding, runtime, candidate),
        ) ?? null,
    ),
  );
  expect(work.slice(rows.length).map((item) => item.issue)).toEqual([]);
});

it("keeps URL parsing growth linear as runtime and issue lists double", async () => {
  const connection = SYMPHONY_FIXTURE_CONNECTIONS[0]!;
  const issue = await createFixtureService().get({
    repo: "yu/Arco",
    number: 42,
  });
  const snapshot = await createSymphonyFixtureService().getState({
    connectionId: connection.id,
  });
  const issues = Array.from({ length: 500 }, (_, index) => ({
    ...issue,
    number: index + 1,
    url: `https://github.com/yu/Arco/issues/${index + 1}`,
  }));
  const rows = issues.map((candidate) => ({
    ...snapshot.rows[0]!,
    issueId: String(candidate.number),
    issueIdentifier: `GH-${candidate.number}`,
    issueUrl: candidate.url,
  }));
  let parses = 0;
  const OriginalURL = URL;
  vi.stubGlobal(
    "URL",
    class extends OriginalURL {
      constructor(input: string | URL, base?: string | URL) {
        super(input, base);
        parses += 1;
      }
    },
  );
  try {
    const counts = [250, 500].map((size) => {
      parses = 0;
      const subset = issues.slice(0, size);
      const work = symphonyWorkItems(connection, rows.slice(0, size), subset);
      expect(work.map((item) => item.issue)).toEqual(subset);
      return parses;
    });
    expect(counts[1]).toBeLessThanOrEqual(counts[0] * 2.5);
  } finally {
    vi.unstubAllGlobals();
  }
});
