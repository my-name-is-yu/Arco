import { toolFailure } from "./tool-failure";
import { expect, test, type Page } from "./browser-test";
import { choose, selectControl } from "./select-helpers";

const app = (page: Page) => page.frameLocator("#arco");
const titles = {
  github: "Preserve issue selection and scroll position",
  linear: "Keep Linear workflow states intact",
};

for (const source of ["github", "linear"] as const) {
  test(`${source} bulk actions retain controls, pending locks, retry IDs, and results across source switches`, async ({
    page,
  }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: Record<string, unknown>[] = [];
    const tool = source === "github" ? "arco_change_labels" : "linear_bulk";
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: Record<string, unknown>;
      };
      if (input.name !== tool) return route.continue();
      calls.push(input.arguments);
      if (calls.length === 1) {
        await pending;
        return route.fulfill({
          json: toolFailure(
            "Unable to confirm this batch. Refresh before retrying.",
          ),
        });
      }
      return route.continue();
    });
    try {
      await page.goto("/?entry=project&toolLimit=2");
      await expect(page.locator("#bridge-status")).toHaveText("ready");
      const ui = app(page);
      if (source === "linear") await choose(ui, "Issue source", "linear");
      await expect(
        ui.getByRole("heading", { name: titles[source], exact: true }),
      ).toBeVisible();
      await ui
        .getByRole("checkbox", {
          name:
            source === "github"
              ? "Select yu/Arco #42 for bulk actions"
              : "YU-42 — select for bulk actions",
        })
        .check();
      const bulk = ui.getByRole("region", {
        name:
          source === "github" ? "Bulk issue actions" : "Bulk Linear actions",
      });
      const actionLabel =
        source === "github" ? "Bulk action" : "Bulk Linear action";
      const valueLabel =
        source === "github" ? "Bulk value" : "Bulk Linear priority";
      const action = source === "github" ? "label-add" : "priority";
      const value = source === "github" ? "bug" : "4";
      await choose(bulk, actionLabel, action);
      await choose(bulk, valueLabel, value);
      await bulk.getByRole("button", { name: "Apply", exact: true }).click();
      await expect.poll(() => calls.length).toBe(1);
      const other = source === "github" ? "linear" : "github";
      const switchBack = async () => {
        await choose(ui, "Issue source", other);
        await expect(
          ui.getByRole("heading", { name: titles[other], exact: true }),
        ).toBeVisible();
        await choose(ui, "Issue source", source);
        await expect(
          ui.getByRole("heading", { name: titles[source], exact: true }),
        ).toBeVisible();
      };
      await switchBack();
      await expect(selectControl(bulk, actionLabel)).toHaveAttribute(
        "data-value",
        action,
      );
      await expect(selectControl(bulk, valueLabel)).toHaveAttribute(
        "data-value",
        value,
      );
      await expect(
        bulk.getByRole("button", {
          name: /Applying/,
        }),
      ).toBeDisabled();
      expect(calls).toHaveLength(1);
      release();
      const apply = bulk.getByRole("button", {
        name: "Apply",
        exact: true,
      });
      if (source === "github") await expect(apply).toBeDisabled();
      else await expect(apply).toBeEnabled();
      await switchBack();
      if (source === "github") {
        await expect(bulk.locator(".bulk-results")).toContainText(
          "Unable to confirm this batch",
        );
        await bulk
          .getByRole("button", {
            name: "Retry failed issues only",
            exact: true,
          })
          .click();
      } else {
        await expect(
          ui
            .getByRole("alert")
            .filter({ hasText: "Unable to confirm this batch" }),
        ).toBeVisible();
        await bulk.getByRole("button", { name: "Apply", exact: true }).click();
      }
      await expect.poll(() => calls.length).toBe(2);
      expect(calls[1].requestId).toBe(calls[0].requestId);
      await expect(bulk).toHaveCount(0);
      await switchBack();
      await expect(bulk).toHaveCount(0);
      await expect(
        ui.getByRole("checkbox", {
          name:
            source === "github"
              ? "Select yu/Arco #42 for bulk actions"
              : "YU-42 — select for bulk actions",
        }),
      ).not.toBeChecked();
      expect(calls).toHaveLength(2);
      await expect(page.locator("#harness-error")).toBeEmpty();
    } finally {
      release();
    }
  });
}
