import { describe, expect, it, vi } from "vitest";
import { createFixtureService, FIXTURE_REPO } from "../src/server/fixture";
import { createGitHubOperations } from "../src/server/github-operations";
import {
  createGitHubWriteGuard,
  GitHubError,
  type GhRunner,
} from "../src/server/github/transport";
import { trackWrite } from "../src/server/write-guard";
import type { IssueDetail } from "../src/shared/contracts";

const ref = { repo: FIXTURE_REPO, number: 42 };

function trackedFixture(rejectNumber?: number) {
  const service = createFixtureService();
  const write = vi.fn(service.update);
  const once = createGitHubWriteGuard<IssueDetail>(
    async () => "test-credential",
  );
  service.update = vi.fn((input) =>
    once(input.requestId, input, async () => {
      if (input.number === rejectNumber)
        throw new GitHubError("No permission for this issue", "forbidden");
      return trackWrite(() => write(input));
    }),
  );
  return { service, write };
}

describe("production GitHub bulk mutation outcomes", () => {
  it("keeps a later member's preflight rejection retryable after an earlier member writes", async () => {
    const { service, write } = trackedFixture(43);
    const operations = createGitHubOperations({
      credentialIdentity: async () => "test-credential",
      service,
    });
    const result = await operations.bulkUpdate({
      requestId: "bulk-independent-member-progress",
      issues: [ref, { ...ref, number: 43 }],
      patch: { state: "closed" },
    });
    if (!("results" in result)) throw new Error("Expected bulk member results");

    expect(result.results).toMatchObject([
      { ...ref, ok: true },
      {
        ...ref,
        number: 43,
        ok: false,
        errorCode: "forbidden",
        needsConfirmation: false,
      },
    ]);
    expect(write).toHaveBeenCalledOnce();
    expect((await service.get(ref)).state).toBe("closed");
    expect((await service.get({ ...ref, number: 43 })).state).toBe("open");
  });

  for (const code of ["forbidden", "unavailable"] as const) {
    it(`requires confirmation when a member writes before a later ${code} read failure`, async () => {
      const { service, write } = trackedFixture();
      const run = vi.fn<GhRunner>(async () => {
        throw new GitHubError("Could not read the issue attributes", code);
      });
      const operations = createGitHubOperations({
        credentialIdentity: async () => "test-credential",
        service,
        run,
      });
      const input = {
        requestId: `bulk-partially-applied-${code}`,
        issues: [ref],
        patch: { state: "closed" as const, milestoneNumber: 1 },
      };

      const result = await operations.bulkUpdate(input);
      if (!("results" in result))
        throw new Error("Expected bulk member results");

      expect(result.results).toMatchObject([
        { ...ref, ok: false, errorCode: code, needsConfirmation: true },
      ]);
      expect((await service.get(ref)).state).toBe("closed");
      expect(write).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledOnce();

      await expect(operations.bulkUpdate(input)).resolves.toEqual(result);
      expect(write).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledOnce();
    });
  }
});
