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
    await bulk.getByRole("button", { name: "Apply", exact: true }).click();
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
    await expect(bulk).toHaveCount(0);
    expect(calls).toEqual([
      ["fixture-linear-42", "fixture-linear-43"],
      ["fixture-linear-43"],
    ]);
  } finally {
    release();
  }
});

test("a saved-target refresh does not clear a newly changed selection", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holdReads = false;
  let refreshing = false;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { issueId?: string };
    };
    if (
      input.name === "linear_get_issue" &&
      input.arguments.issueId === "fixture-linear-42" &&
      holdReads
    ) {
      refreshing = true;
      await pending;
    }
    if (input.name !== "linear_bulk") return route.continue();
    return route.fulfill({
      json: {
        content: [],
        structuredContent: {
          results: [42, 43].map((number) => ({
            issueId: `fixture-linear-${number}`,
            success: true,
            saved: true,
            retryable: false,
            ...(number === 42
              ? { refreshError: "Refresh this saved target." }
              : {}),
          })),
        },
      },
    });
  });
  try {
    await page.goto("/?source=linear&toolLimit=2");
    const ui = page.frameLocator("#arco");
    const checkbox = (number: number) =>
      ui.getByRole("checkbox", {
        name: `YU-${number} — select for bulk actions`,
      });
    for (const number of [42, 43]) await checkbox(number).check();
    const bulk = ui.getByRole("region", { name: "Bulk Linear actions" });
    await choose(bulk, "Bulk Linear action", "priority");
    await choose(bulk, "Bulk Linear priority", "4");
    await bulk.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(
      bulk.getByRole("list", { name: "Saved issues requiring refresh" }),
    ).toContainText("YU-42");
    holdReads = true;
    await bulk
      .getByRole("button", { name: "Refresh saved issues", exact: true })
      .click();
    await expect.poll(() => refreshing).toBe(true);
    await checkbox(43).uncheck();
    const refreshed = page.waitForResponse((response) => {
      if (!response.url().endsWith("/tool")) return false;
      const input = response.request().postDataJSON() as {
        name?: string;
        arguments?: { issueId?: string };
      };
      return (
        input.name === "linear_get_issue" &&
        input.arguments?.issueId === "fixture-linear-42"
      );
    });
    release();
    await refreshed;
    await choose(ui, "Issue source", "github");
    await choose(ui, "Issue source", "linear");
    await expect(bulk).toContainText("1 selected");
    await expect(checkbox(42)).toBeChecked();
    await expect(checkbox(43)).not.toBeChecked();
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
      name: "Apply",
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
    await expect(retained).toContainText("YU-42");
    await expect(retained).not.toContainText("YU-43");
    await expect(apply).toBeDisabled();
    expect(calls).toEqual([
      ["fixture-linear-42", "fixture-linear-43"],
      ["fixture-linear-43"],
    ]);
    if (outcome === "saved-refresh-failed") {
      await bulk
        .getByRole("button", { name: "Refresh saved issues", exact: true })
        .click();
      await expect(bulk).toHaveCount(0);
      expect(calls).toHaveLength(2);
      for (const number of [42, 43])
        await ui
          .getByRole("checkbox", {
            name: `YU-${number} — select for bulk actions`,
          })
          .check();
      await expect(
        bulk.getByRole("list", { name: "Failed issues" }),
      ).toHaveCount(0);
    }
    await choose(bulk, "Bulk Linear action", "priority");
    await choose(bulk, "Bulk Linear priority", "3");
    await expect(apply).toBeEnabled();
  });
}
