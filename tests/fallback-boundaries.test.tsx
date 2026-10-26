import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ArcoHost,
  Connection,
  IssueDetail,
} from "../src/shared/contracts";
import type { LinearIssue } from "../src/shared/linear";
import { useGitHubComments } from "../src/ui/github-comments";
import { useLinearComments } from "../src/ui/linear-comments";
import { GitHubAuthScopeContext } from "../src/ui/github-auth";
import {
  pageContinuationError,
  requirePageContinuation,
} from "../src/ui/page-continuation";

describe("pagination response boundaries", () => {
  it.each([undefined, null, "", 0, -1, 1.5])(
    "rejects a continued page with invalid continuation %s",
    (continuation) => {
      const page = { hasMore: true, items: ["already read"] };
      expect(() =>
        requirePageContinuation(page, continuation, "Source comments"),
      ).toThrow("no valid continuation");
      expect(page.items).toEqual(["already read"]);
    },
  );

  it.each(["opaque-cursor", 2])(
    "keeps a native continuation %s unchanged",
    (continuation) => {
      const page = { hasMore: true, items: ["read"] };
      expect(
        requirePageContinuation(page, continuation, "Source comments"),
      ).toBe(page);
    },
  );

  it("allows a complete final page without a continuation", () => {
    expect(
      pageContinuationError(false, undefined, "Source comments"),
    ).toBeNull();
  });

  it.each(["github", "linear"] as const)(
    "%s shows missing first-page continuation as an error without inventing or silently finishing a page",
    (source) => {
      const host = { call: vi.fn() } as unknown as ArcoHost;
      const client = new QueryClient();
      const authScope = "fixture-github-session";
      client.setQueryData(["connection"], {
        mode: "fixture",
        connected: true,
        account: "fixture-user",
        authGeneration: authScope,
        message: "Fixture only",
      } satisfies Connection);
      let error: Error | null = null;
      let hasNextPage = true;
      let isError = false;
      function GitHubProbe() {
        const result = useGitHubComments(host, {
          source: "github",
          repo: "owner/repo",
          number: 42,
          id: "issue-42",
          title: "Issue",
          body: "Body",
          state: "open",
          stateReason: null,
          url: "https://github.com/owner/repo/issues/42",
          author: "author",
          updatedAt: "2026-10-24T00:00:00Z",
          labels: [],
          assignees: [],
          projects: [],
          comments: [],
          commentsHasMore: true,
        } satisfies IssueDetail);
        ({ error, hasNextPage, isError } = result);
        return null;
      }
      function LinearProbe() {
        const result = useLinearComments(host, {
          source: "linear",
          connectionId: "connection",
          workspaceId: "workspace",
          teamId: "team",
          issueId: "issue",
          identifier: "TEAM-42",
          title: "Issue",
          body: "Body",
          author: "Author",
          url: "https://linear.app/test/issue/TEAM-42",
          updatedAt: "2026-10-24T00:00:00Z",
          state: {
            id: "state",
            name: "In Progress",
            type: "started",
            color: "#888888",
          },
          assignee: null,
          labels: [],
          priority: 0,
          estimate: null,
          dueDate: null,
          project: null,
          projectMilestone: null,
          cycle: null,
          parent: null,
          children: [],
          comments: [],
          commentsHasMore: true,
          commentsCursor: null,
          attachments: [],
          relations: [],
          reactions: [],
        } satisfies LinearIssue);
        ({ error, hasNextPage, isError } = result);
        return null;
      }
      renderToStaticMarkup(
        <QueryClientProvider client={client}>
          {source === "github" ? (
            <GitHubAuthScopeContext.Provider value={authScope}>
              <GitHubProbe />
            </GitHubAuthScopeContext.Provider>
          ) : (
            <LinearProbe />
          )}
        </QueryClientProvider>,
      );
      expect(isError).toBe(true);
      expect(hasNextPage).toBe(false);
      expect(error).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("no valid continuation"),
        }),
      );
      expect(host.call).not.toHaveBeenCalled();
      client.clear();
    },
  );
});
