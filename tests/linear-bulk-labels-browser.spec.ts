import { expect, test } from "@playwright/test";
import type {
  LinearBulkMemberResult,
  LinearIssueSummary,
} from "../src/shared/linear";
import { choose } from "./select-helpers";

test("Linear bulk failures retain native issue labels after reordering and filtering the list", async ({
  page,
}) => {
  const calls: string[][] = [];
  let reordered = false;
  const issue = (number: number, title: string): LinearIssueSummary => ({
    source: "linear",
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-linear-team",
    issueId: `fixture-linear-${number}`,
    identifier: `YU-${number}`,
    title,
    url: `https://linear.app/fixture/issue/YU-${number}`,
    updatedAt: "2026-10-24T00:00:00.000Z",
    state: {
      id: "linear-state-progress",
      name: "In Progress",
      type: "started",
      color: "#f2c94c",
    },
  });
  const first = issue(42, "Saved issue awaiting refresh");
  const second = issue(43, "Issue with a rejected change");
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { issueIds: string[]; query?: string };
    };
    if (input.name === "linear_list_issues") {
      const issues = input.arguments.query
        ? [issue(44, "Unrelated filter result")]
        : reordered
          ? [second, first]
          : [first, second];
      return route.fulfill({
        json: {
          content: [],
          structuredContent: { issues, hasMore: false, cursor: null },
        },
      });
    }
    if (input.name !== "linear_bulk") return route.continue();
    calls.push(input.arguments.issueIds);
    reordered = true;
    const results: LinearBulkMemberResult[] =
      calls.length === 1
        ? [
            {
              issueId: second.issueId,
              success: false,
              saved: false,
              retryable: true,
              error: "Permission denied.",
            },
            {
              issueId: first.issueId,
              success: true,
              saved: true,
              retryable: false,
              refreshError: "Could not refresh the saved issue.",
            },
          ]
        : [
            {
              issueId: second.issueId,
              success: true,
              saved: true,
              retryable: false,
            },
          ];
    return route.fulfill({
      json: { content: [], structuredContent: { results } },
    });
  });
  await page.goto("/?source=linear");
  const ui = page.frameLocator("#arco");
  for (const number of [42, 43])
    await ui
      .getByRole("checkbox", {
        name: `YU-${number} — select for bulk actions`,
      })
      .check();
  const bulk = ui.getByRole("region", { name: "Bulk Linear actions" });
  await choose(bulk, "Bulk Linear action", "priority");
  await choose(bulk, "Bulk Linear priority", "4");
  await bulk.getByRole("button", { name: "Apply", exact: true }).click();
  const failures = bulk.getByRole("list", {
    name: "Failed issues",
    exact: true,
  });
  const refreshFailures = bulk.getByRole("list", {
    name: "Saved issues requiring refresh",
    exact: true,
  });
  await expect(failures).toContainText(
    "YU-43 · Issue with a rejected change: Permission denied.",
  );
  await expect(refreshFailures).toContainText(
    "YU-42 · Saved issue awaiting refresh: Could not refresh the saved issue.",
  );
  await expect(ui.locator(".linear-list-row .issue-row").first()).toContainText(
    second.title,
  );
  await ui
    .getByRole("textbox", { name: "Search Linear Issues" })
    .fill("hidden");
  await expect(
    ui.getByRole("checkbox", { name: "YU-44 — select for bulk actions" }),
  ).toBeVisible();
  await expect(
    ui.getByRole("checkbox", { name: "YU-43 — select for bulk actions" }),
  ).toHaveCount(0);
  await expect(failures).toContainText("YU-43 · Issue with a rejected change");
  await expect(refreshFailures).toContainText(
    "YU-42 · Saved issue awaiting refresh",
  );
  await expect(bulk).not.toContainText("fixture-linear-");
  await bulk
    .getByRole("button", { name: "Retry failed issues only", exact: true })
    .click();
  await expect(failures).toHaveCount(0);
  await expect(refreshFailures).toContainText("YU-42");
  expect(calls).toEqual([[first.issueId, second.issueId], [second.issueId]]);
});
