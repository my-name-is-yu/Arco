import { expect, it } from "vitest";
import { createFixtureService, FIXTURE_REPO } from "../src/server/fixture";
import { createGitHubOperationContext } from "../src/server/github/operations-context";

it("keeps the initial service when the caller replaces its options reference", async () => {
  const initial = createFixtureService();
  const replacement = createFixtureService();
  const ref = { repo: FIXTURE_REPO, number: 42 };
  initial.fixture.mutate(ref, (issue) => {
    issue.title = "Initial fixture source";
  });
  replacement.fixture.mutate(ref, (issue) => {
    issue.title = "Replacement fixture source";
  });
  const options = { service: initial };
  const context = createGitHubOperationContext(options);
  options.service = replacement;

  expect(context.service).toBe(initial);
  expect(await context.refresh(ref)).toMatchObject({
    issue: { title: "Initial fixture source" },
  });
});
