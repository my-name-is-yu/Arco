import { expect, it } from "vitest";
import { createFixtureService } from "../src/server/fixture";
import { createLinearFixtureService } from "../src/server/linear/fixture";
import type { LinearIssue } from "../src/shared/linear";
import {
  createSymphonyFixtureService,
  SYMPHONY_FIXTURE_CONNECTIONS,
} from "../src/server/symphony-fixture";
import {
  resolveSymphonySelection,
  symphonyNativeSelection,
  symphonySelectionKey,
} from "../src/ui/symphony-navigation";
import { symphonyWorkItems } from "../src/ui/symphony-queries";

async function fixtures() {
  const connection = SYMPHONY_FIXTURE_CONNECTIONS[0]!;
  const issue = await createFixtureService().get({
    repo: "yu/Arco",
    number: 42,
  });
  const snapshot = await createSymphonyFixtureService().getState({
    connectionId: connection.id,
  });
  const runtime = snapshot.rows.find((row) => row.issueIdentifier === "GH-42")!;
  const nativeIssue = {
    source: "github" as const,
    repo: issue.repo,
    number: issue.number,
    url: issue.url,
  };
  return { connection, issue, runtime, nativeIssue };
}

it("native View run selects its own issue instead of an unrelated same-number runtime", async () => {
  const { connection, issue, runtime, nativeIssue } = await fixtures();
  const foreign = {
    ...runtime,
    issueUrl: "https://github.com/other/project/issues/42",
  };
  const items = symphonyWorkItems(connection, [foreign], [issue]);
  expect(
    resolveSymphonySelection(connection, items, {
      connectionId: connection.id,
      issueIdentifier: "GH-42",
      nativeIssue,
    }),
  ).toMatchObject({ issue, runtime: null });
  expect(
    resolveSymphonySelection(
      connection,
      items.filter((item) => item.runtime),
      { connectionId: connection.id, issueIdentifier: "GH-42", nativeIssue },
    ),
  ).toBeUndefined();
});

it("resolves a canonically matching runtime before native issue pages are loaded", async () => {
  const { connection, runtime, nativeIssue } = await fixtures();
  const items = symphonyWorkItems(connection, [runtime], []);
  expect(
    resolveSymphonySelection(connection, items, {
      connectionId: connection.id,
      issueIdentifier: "GH-42",
      nativeIssue,
    })?.runtime,
  ).toEqual(runtime);
  expect(
    resolveSymphonySelection(connection, items, {
      connectionId: connection.id,
      issueIdentifier: "GH-42",
      nativeIssue: { ...nativeIssue, repo: "other/project" },
    }),
  ).toBeUndefined();
  expect(
    resolveSymphonySelection(connection, items, {
      connectionId: "other-instance",
      issueIdentifier: "GH-42",
      nativeIssue,
    }),
  ).toBeUndefined();
});

it("preserves identifier-only launch resolution within the selected instance", async () => {
  const { connection, issue, runtime } = await fixtures();
  const foreign = {
    ...runtime,
    issueUrl: "https://github.com/other/project/issues/42",
  };
  const items = symphonyWorkItems(connection, [foreign], [issue]);
  expect(
    resolveSymphonySelection(connection, items, {
      connectionId: connection.id,
      issueIdentifier: "GH-42",
    })?.runtime,
  ).toEqual(foreign);
});

it("keeps native selection identity through dispatch changes and scopes runtime-only choices by key", async () => {
  const { connection, issue, runtime } = await fixtures();
  const selection = symphonyNativeSelection(connection.id, "GH-42", issue);
  const identity = symphonySelectionKey(selection);
  for (const rows of [
    [],
    [runtime],
    [],
    [{ ...runtime, issueId: "restarted", key: "new-key" }],
  ]) {
    const selected = resolveSymphonySelection(
      connection,
      symphonyWorkItems(connection, rows, [issue]),
      selection,
    );
    expect(selected?.issue).toEqual(issue);
    expect(selected?.runtime).toEqual(rows[0] ?? null);
  }
  expect(
    symphonySelectionKey(
      symphonyNativeSelection(connection.id, "renamed", {
        ...issue,
        repo: "YU/ARCO",
        url: `${issue.url}/`,
      }),
    ),
  ).toBe(identity);
  const foreign = {
    ...runtime,
    key: "foreign",
    issueUrl: "https://github.com/other/project/issues/42",
  };
  const runtimeSelection = {
    connectionId: connection.id,
    issueIdentifier: "GH-42",
    runtimeKey: foreign.key,
  };
  expect(
    resolveSymphonySelection(
      connection,
      symphonyWorkItems(connection, [runtime, foreign], [issue]),
      runtimeSelection,
    )?.runtime,
  ).toEqual(foreign);
  expect(
    resolveSymphonySelection(
      connection,
      symphonyWorkItems(connection, [runtime], [issue]),
      runtimeSelection,
    ),
  ).toBeUndefined();
});

it("keeps Linear View run within its native connection, workspace and team", async () => {
  const connection = SYMPHONY_FIXTURE_CONNECTIONS[1]!;
  const issue = (await createLinearFixtureService().call("linear_get_issue", {
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-linear-team",
    issueId: "fixture-linear-42",
  })) as LinearIssue;
  const snapshot = await createSymphonyFixtureService().getState({
    connectionId: connection.id,
  });
  const runtime = snapshot.rows.find(
    (row) => row.issueIdentifier === issue.identifier,
  )!;
  const nativeIssue = {
    source: "linear" as const,
    connectionId: issue.connectionId,
    workspaceId: issue.workspaceId,
    teamId: issue.teamId,
    issueId: issue.issueId,
    url: issue.url,
  };
  const foreign = {
    ...runtime,
    issueUrl: "https://linear.app/other/issue/YU-42",
  };
  const items = symphonyWorkItems(connection, [foreign], [issue]);
  const selection = {
    connectionId: connection.id,
    issueIdentifier: issue.identifier,
    nativeIssue,
  };
  expect(resolveSymphonySelection(connection, items, selection)).toMatchObject({
    issue,
    runtime: null,
  });
  for (const field of [
    "connectionId",
    "workspaceId",
    "teamId",
    "issueId",
  ] as const) {
    expect(
      resolveSymphonySelection(connection, items, {
        ...selection,
        nativeIssue: { ...nativeIssue, [field]: "other" },
      }),
    ).toBeUndefined();
  }
  const runtimeOnly = symphonyWorkItems(connection, [runtime], []);
  expect(
    resolveSymphonySelection(connection, runtimeOnly, selection)?.runtime,
  ).toEqual(runtime);
});
