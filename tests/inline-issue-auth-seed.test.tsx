import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureService, FIXTURE_REPO } from "../src/server/fixture";
import {
  createLinearFixtureService,
  LINEAR_FIXTURE_SCOPE,
} from "../src/server/linear/fixture";
import type {
  ArcoHost,
  Connection,
  ConversationIssue,
  PresentationIssues,
} from "../src/shared/contracts";
import {
  issuePresentationSummarySchema,
  type IssuePresentationSummary,
} from "../src/shared/launch";
import type { LinearIssue } from "../src/shared/linear";
import { GitHubAuthScopeContext } from "../src/ui/github-auth";
import { InlineIssueTabs, presentationTarget } from "../src/ui/InlineIssueTabs";

const scopeA = "fixture-github-session";
const scopeB = "fixture-next-session";
const clients: QueryClient[] = [];
let details: ConversationIssue[];
function summaries(issues: ConversationIssue[]): IssuePresentationSummary[] {
  return issues.map((issue) =>
    issuePresentationSummarySchema.options[issue.source === "github" ? 0 : 1]
      .strip()
      .parse(issue),
  );
}
function renderTabs(
  client: QueryClient,
  host: ArcoHost,
  launchIssues: IssuePresentationSummary[],
  scope: string | null,
) {
  if (scope !== null)
    client.setQueryData(["connection"], {
      mode: "fixture",
      connected: true,
      account: "fixture-user",
      authGeneration: scope,
      message: "Fixture only",
    } satisfies Connection);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <GitHubAuthScopeContext.Provider value={scope}>
        <InlineIssueTabs
          host={host}
          issues={launchIssues}
          activeTarget={presentationTarget(launchIssues[0])}
          onSelect={() => {}}
        >
          <p>Fixture details</p>
        </InlineIssueTabs>
      </GitHubAuthScopeContext.Provider>
    </QueryClientProvider>,
  );
}
function queryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
    },
  });
  clients.push(client);
  return client;
}
function hostWithSnapshot(read: () => PresentationIssues | null) {
  return {
    presentationIssues: read,
    call: vi.fn(),
    readImage: vi.fn(),
  } as unknown as ArcoHost;
}
beforeEach(async () => {
  const github = createFixtureService();
  const linear = createLinearFixtureService();
  details = await Promise.all([
    github.get({ repo: FIXTURE_REPO, number: 42 }),
    github.get({ repo: FIXTURE_REPO, number: 43 }),
    linear.call("linear_get_issue", {
      ...LINEAR_FIXTURE_SCOPE,
      issueId: "fixture-linear-42",
    }) as Promise<LinearIssue>,
    linear.call("linear_get_issue", {
      ...LINEAR_FIXTURE_SCOPE,
      issueId: "fixture-linear-43",
    }) as Promise<LinearIssue>,
  ]);
  details = details.map((issue) => ({
    ...issue,
    body: "Fixture body without images",
  }));
});
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

describe("inline issue authentication seeding", () => {
  it.each(["github", "mixed"] as const)(
    "remounts %s tabs from the current snapshot rather than the original launch after cache eviction",
    (kind) => {
      const original = [details[0], details[kind === "mixed" ? 2 : 1]].map(
        (issue) => ({ ...issue, title: `Original A ${issue.source} title` }),
      );
      const launchIssues = summaries(original);
      const client = queryClient();
      let snapshot: PresentationIssues = {
        issues: original,
        receivedAt: 1000,
        githubAuthGeneration: scopeA,
      };
      const host = hostWithSnapshot(() => snapshot);
      expect(renderTabs(client, host, launchIssues, scopeA)).toContain(
        "Original A github title",
      );
      client.removeQueries({ queryKey: ["issue-set"] });
      snapshot = {
        issues: original.map((issue): ConversationIssue =>
          issue.source === "github"
            ? {
                ...issue,
                title: `Current B GitHub #${issue.number}`,
                state: "closed",
                stateReason: "completed",
              }
            : { ...issue, title: "Current Linear snapshot title" },
        ),
        receivedAt: 2000,
        githubAuthGeneration: scopeB,
      };
      const key = ["issue-set", launchIssues.map(presentationTarget), scopeB];
      for (let mount = 0; mount < 2; mount += 1) {
        const html = renderTabs(client, host, launchIssues, scopeB);
        expect(client.getQueryData(key)).toEqual(summaries(snapshot.issues));
        expect(html).toContain("Current B GitHub #42");
        expect(html).not.toContain("Original A");
        expect(html).toContain(`data-arco-github-auth-generation="${scopeB}"`);
        if (kind === "mixed")
          expect(html).toContain("Current Linear snapshot title");
        for (const summary of client.getQueryData<IssuePresentationSummary[]>(
          key,
        )!) {
          expect(summary).not.toHaveProperty("body");
          expect(summary).not.toHaveProperty("comments");
        }
        client.removeQueries({ queryKey: key, exact: true });
      }
      expect(host.call).not.toHaveBeenCalled();
    },
  );

  it.each([
    "reordered",
    "missing",
    "different GitHub target",
    "different Linear target",
  ] as const)(
    "does not seed a matching-generation snapshot with %s",
    (mismatch) => {
      const original = [details[0], details[2]];
      const launchIssues = summaries(original);
      const current = original.map((issue) => ({
        ...issue,
        title: "Current snapshot title",
      }));
      if (mismatch === "reordered") current.reverse();
      if (mismatch === "missing") current.pop();
      if (mismatch === "different GitHub target")
        current[0] = { ...details[1] };
      if (mismatch === "different Linear target")
        current[1] = { ...details[3] };
      const host = hostWithSnapshot(() => ({
        issues: current,
        receivedAt: 2000,
        githubAuthGeneration: scopeB,
      }));
      const client = queryClient();
      const html = renderTabs(client, host, launchIssues, scopeB);
      expect(
        client.getQueryData([
          "issue-set",
          launchIssues.map(presentationTarget),
          scopeB,
        ]),
      ).toBeUndefined();
      expect(html).not.toContain('role="tab"');
      expect(host.call).not.toHaveBeenCalled();
    },
  );

  it("keeps pure Linear launch seeding independent of GitHub authentication and snapshots", () => {
    const launchIssues = summaries([details[2], details[3]]);
    const host = hostWithSnapshot(() => ({
      issues: [details[0], details[1]],
      receivedAt: 2000,
      githubAuthGeneration: scopeB,
    }));
    const client = queryClient();
    const html = renderTabs(client, host, launchIssues, null);
    expect(
      client.getQueryData(["issue-set", launchIssues.map(presentationTarget)]),
    ).toEqual(launchIssues);
    expect(html).toContain(launchIssues[0].title);
    expect(html).not.toContain("data-arco-github-auth-generation");
    expect(host.call).not.toHaveBeenCalled();
  });
});
