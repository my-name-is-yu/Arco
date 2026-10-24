import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixtureService, FIXTURE_REPO } from "../src/server/fixture";
import {
  createLinearFixtureService,
  LINEAR_FIXTURE_SCOPE,
} from "../src/server/linear/fixture";
import type {
  ArcoHost,
  ConversationIssue,
  PresentationIssues,
} from "../src/shared/contracts";
import type { LinearIssue } from "../src/shared/linear";
import { seedPresentationCache } from "../src/ui/presentation-cache";

const receivedAt = 1_000;
const sources = ["github", "linear"] as const;
let client: QueryClient;
let issues: ConversationIssue[];

function hostWithSnapshot(getSnapshot: () => PresentationIssues | null) {
  return { presentationIssues: getSnapshot } as ArcoHost;
}

function issueFor(source: (typeof sources)[number]) {
  return issues.find((issue) => issue.source === source)!;
}

function expectedKey(issue: ConversationIssue) {
  return issue.source === "github"
    ? ["issue", issue.repo, issue.number]
    : [
        "linear-issue",
        {
          connectionId: issue.connectionId,
          workspaceId: issue.workspaceId,
          teamId: issue.teamId,
          issueId: issue.issueId,
        },
      ];
}

beforeEach(async () => {
  client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  const github = createFixtureService();
  const linear = createLinearFixtureService();
  issues = await Promise.all([
    github.get({ repo: FIXTURE_REPO, number: 42 }),
    linear.call("linear_get_issue", {
      ...LINEAR_FIXTURE_SCOPE,
      issueId: "fixture-linear-42",
    }) as Promise<LinearIssue>,
    github.get({ repo: FIXTURE_REPO, number: 43 }),
    linear.call("linear_get_issue", {
      ...LINEAR_FIXTURE_SCOPE,
      issueId: "fixture-linear-43",
    }) as Promise<LinearIssue>,
  ]);
});

afterEach(() => client.clear());

describe("presentation detail cache", () => {
  it("seeds all four mixed-provider details under their normal query keys", () => {
    seedPresentationCache(
      client,
      hostWithSnapshot(() => ({ issues, receivedAt })),
    );

    expect(client.getQueryCache().getAll()).toHaveLength(4);
    for (const issue of issues) {
      expect(client.getQueryData(expectedKey(issue))).toEqual(issue);
      expect(client.getQueryState(expectedKey(issue))).toMatchObject({
        dataUpdatedAt: receivedAt,
        isInvalidated: false,
      });
    }
  });

  it("supports hosts without snapshots and a snapshot that has not arrived", () => {
    seedPresentationCache(client, {} as ArcoHost);
    seedPresentationCache(
      client,
      hostWithSnapshot(() => null),
    );
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it.each(sources)(
    "keeps a %s detail received after the presentation snapshot",
    (source) => {
      const issue = issueFor(source);
      const newerRead = { ...issue, body: "Body from a later issue read" };
      client.setQueryData(expectedKey(issue), newerRead, {
        updatedAt: receivedAt + 1,
      });

      seedPresentationCache(
        client,
        hostWithSnapshot(() => ({ issues: [issue], receivedAt })),
      );

      expect(client.getQueryData(expectedKey(issue))).toEqual(newerRead);
      expect(client.getQueryState(expectedKey(issue))?.dataUpdatedAt).toBe(
        receivedAt + 1,
      );
    },
  );

  it.each(sources)(
    "keeps a newer provider revision of a %s issue even with an older cache timestamp",
    (source) => {
      const issue = issueFor(source);
      const newerRevision = {
        ...issue,
        body: "A newer change saved by the source service",
        updatedAt: new Date(Date.parse(issue.updatedAt) + 1_000).toISOString(),
      };
      client.setQueryData(expectedKey(issue), newerRevision, {
        updatedAt: receivedAt - 1,
      });

      seedPresentationCache(
        client,
        hostWithSnapshot(() => ({ issues: [issue], receivedAt })),
      );

      expect(client.getQueryData(expectedKey(issue))).toEqual(newerRevision);
      expect(client.getQueryState(expectedKey(issue))?.dataUpdatedAt).toBe(
        receivedAt - 1,
      );
    },
  );

  it("does not make an invalidated issue fresh when the same snapshot is seeded again", async () => {
    const host = hostWithSnapshot(() => ({ issues, receivedAt }));
    seedPresentationCache(client, host);
    await client.invalidateQueries({ refetchType: "none" });

    seedPresentationCache(client, host);

    for (const issue of issues)
      expect(client.getQueryState(expectedKey(issue))).toMatchObject({
        dataUpdatedAt: receivedAt,
        isInvalidated: true,
      });
  });

  it("applies a later snapshot and makes its updated issue details fresh", async () => {
    let snapshot: PresentationIssues = { issues, receivedAt };
    const host = hostWithSnapshot(() => snapshot);
    seedPresentationCache(client, host);
    await client.invalidateQueries({ refetchType: "none" });
    snapshot = {
      receivedAt: receivedAt + 100,
      issues: issues.map((issue) => ({
        ...issue,
        body: `${issue.body}\n\nNew source content`,
        updatedAt: new Date(Date.parse(issue.updatedAt) + 1_000).toISOString(),
      })),
    };

    seedPresentationCache(client, host);

    for (const issue of snapshot.issues) {
      expect(client.getQueryData(expectedKey(issue))).toEqual(issue);
      expect(client.getQueryState(expectedKey(issue))).toMatchObject({
        dataUpdatedAt: snapshot.receivedAt,
        isInvalidated: false,
      });
    }
  });
});
