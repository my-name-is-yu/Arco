import { expect, test } from "@playwright/test";
import { choose } from "./select-helpers";
import type { LinearBulkMemberResult } from "../src/shared/linear";

test("bulk retry waits until a saved target has finished refreshing", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holdReads = false;
  const calls: string[][] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { issueIds: string[]; issueId?: string };
    };
    if (
      input.name === "linear_get_issue" &&
      input.arguments.issueId === "fixture-linear-42" &&
      holdReads
    ) {
      await pending;
      return route.continue();
    }
    if (input.name !== "linear_bulk") return route.continue();
    calls.push(input.arguments.issueIds);
    const results: LinearBulkMemberResult[] =
      calls.length === 1
        ? [
            {
              issueId: "fixture-linear-42",
              success: true,
              saved: true,
              retryable: false,
              refreshError: "Refresh this saved target.",
            },
            {
              issueId: "fixture-linear-43",
              success: false,
              saved: false,
              retryable: true,
              error: "Permission denied before any change.",
            },
          ]
        : [
            {
              issueId: "fixture-linear-43",
              success: true,
              saved: true,
              retryable: false,
            },
          ];
    return route.fulfill({
      json: { content: [], structuredContent: { results } },
    });
  });
  try {
    await page.goto("/?source=linear&toolLimit=2");
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
    await bulk
      .getByRole("button", { name: "Apply to 2 issues", exact: true })
      .click();
    const retry = bulk.getByRole("button", {
      name: "Retry failed issues only",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    holdReads = true;
    await bulk
      .getByRole("button", { name: "Refresh saved issues", exact: true })
      .click();
    await expect(retry).toBeDisabled();
    expect(calls).toHaveLength(1);
    release();
    await expect(
      bulk.getByRole("list", { name: "Saved issues requiring refresh" }),
    ).toHaveCount(0);
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(
      bulk.getByRole("button", { name: "Apply to 2 issues", exact: true }),
    ).toBeEnabled();
    expect(calls).toEqual([
      ["fixture-linear-42", "fixture-linear-43"],
      ["fixture-linear-43"],
    ]);
  } finally {
    release();
  }
});

for (const outcome of ["saved-refresh-failed", "uncertain"] as const) {
  test(`bulk ${outcome} targets are excluded from retry and retained after another target recovers`, async ({
    page,
  }) => {
    const calls: string[][] = [];
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { issueIds: string[] };
      };
      if (input.name !== "linear_bulk") return route.continue();
      calls.push(input.arguments.issueIds);
      const first: LinearBulkMemberResult =
        outcome === "saved-refresh-failed"
          ? {
              issueId: "fixture-linear-42",
              success: true,
              saved: true,
              retryable: false,
              refreshError: "Saved; refresh this issue before another change.",
            }
          : {
              issueId: "fixture-linear-42",
              success: false,
              saved: false,
              retryable: false,
              error: "Check Linear before retrying this uncertain change.",
            };
      const results =
        calls.length === 1
          ? [
              first,
              {
                issueId: "fixture-linear-43",
                success: false,
                saved: false,
                retryable: true,
                error: "Permission denied before any change.",
              },
            ]
          : [
              {
                issueId: "fixture-linear-43",
                success: true,
                saved: true,
                retryable: false,
              },
            ];
      return route.fulfill({
        json: { content: [], structuredContent: { results } },
      });
    });
    await page.goto("/?source=linear&toolLimit=2");
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
    const apply = bulk.getByRole("button", {
      name: "Apply to 2 issues",
      exact: true,
    });
    await apply.click();
    const retry = bulk.getByRole("button", {
      name: "Retry failed issues only",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await expect(apply).toBeDisabled();
    await retry.click();
    await expect(retry).toHaveCount(0);
    const retained = bulk.getByRole("list", {
      name:
        outcome === "saved-refresh-failed"
          ? "Saved issues requiring refresh"
          : "Failed issues",
      exact: true,
    });
    await expect(retained).toContainText("fixture-linear-42");
    await expect(retained).not.toContainText("fixture-linear-43");
    await expect(apply).toBeDisabled();
    expect(calls).toEqual([
      ["fixture-linear-42", "fixture-linear-43"],
      ["fixture-linear-43"],
    ]);
    if (outcome === "saved-refresh-failed") {
      await bulk
        .getByRole("button", { name: "Refresh saved issues", exact: true })
        .click();
      await expect(retained).toHaveCount(0);
      await expect(apply).toBeEnabled();
      expect(calls).toHaveLength(2);
    }
    await choose(bulk, "Bulk Linear priority", "3");
    await expect(apply).toBeEnabled();
  });
}
