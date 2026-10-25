import { expect, test } from "@playwright/test";
import { choose, selectControl } from "./select-helpers";

for (const source of ["github", "linear"] as const) {
  test(`${source} bulk completion clears selection after switching sources during apply`, async ({
    page,
  }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const tool = source === "github" ? "arco_change_labels" : "linear_bulk";
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      if (input.name === tool && ++calls === 1) await pending;
      return route.continue();
    });
    try {
      await page.goto("/?entry=project&toolLimit=2");
      const ui = page.frameLocator("#arco");
      if (source === "linear") await choose(ui, "Issue source", source);
      const checkbox = (number: number) =>
        ui.getByRole("checkbox", {
          name:
            source === "github"
              ? `Select yu/Arco #${number} for bulk actions`
              : `YU-${number} — select for bulk actions`,
        });
      for (const number of [42, 43]) await checkbox(number).check();
      const bulk = ui.getByRole("region", {
        name:
          source === "github" ? "Bulk issue actions" : "Bulk Linear actions",
      });
      await choose(
        bulk,
        source === "github" ? "Bulk action" : "Bulk Linear action",
        source === "github" ? "label-add" : "priority",
      );
      await choose(
        bulk,
        source === "github" ? "Bulk value" : "Bulk Linear priority",
        source === "github" ? "bug" : "4",
      );
      const apply = bulk.getByRole("button", {
        name: "Apply to 2 issues",
        exact: true,
      });
      const listBox = await ui.locator(".issue-list").boundingBox();
      const panelBox = await bulk.boundingBox();
      const sidebarBox = await ui.locator(".issue-sidebar").boundingBox();
      const pickerBox = await selectControl(
        bulk,
        source === "github" ? "Bulk action" : "Bulk Linear action",
      )
        .getByRole("button")
        .boundingBox();
      const applyBox = await apply.boundingBox();
      expect(
        listBox && panelBox && sidebarBox && pickerBox && applyBox,
      ).toBeTruthy();
      expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(panelBox!.y + 1);
      expect(panelBox!.y + panelBox!.height).toBeCloseTo(
        sidebarBox!.y + sidebarBox!.height,
        0,
      );
      expect(pickerBox!.x).toBeCloseTo(applyBox!.x, 0);
      expect(pickerBox!.width).toBeCloseTo(applyBox!.width, 0);
      await expect(bulk).not.toContainText(/Review targets|Review target IDs/);
      await apply.click();
      await expect.poll(() => calls).toBe(1);
      await expect(bulk).toBeVisible();
      await expect(
        bulk.getByRole("button", {
          name: /Applying/,
        }),
      ).toBeDisabled();
      await choose(
        ui,
        "Issue source",
        source === "github" ? "linear" : "github",
      );
      release();
      await choose(ui, "Issue source", source);
      await expect(bulk).toHaveCount(0);
      for (const number of [42, 43]) {
        await expect(checkbox(number)).not.toBeChecked();
        await checkbox(number).check();
      }
      await expect(bulk).toContainText("2 selected");
      await expect(bulk.locator(".bulk-results")).toHaveCount(0);
      await expect(
        bulk.getByRole("list", { name: "Saved issues requiring refresh" }),
      ).toHaveCount(0);
      expect(calls).toBe(source === "github" ? 2 : 1);
      await expect(page.locator("#harness-error")).toBeEmpty();
    } finally {
      release();
    }
  });
}

test("GitHub bulk attribute completion closes the panel and clears every target", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "arco_bulk_update") calls += 1;
    return route.continue();
  });
  await page.goto("/?entry=project");
  const ui = page.frameLocator("#arco");
  for (const number of [42, 43])
    await ui
      .getByRole("checkbox", {
        name: `Select yu/Arco #${number} for bulk actions`,
      })
      .check();
  const bulk = ui.getByRole("region", { name: "Bulk issue actions" });
  await choose(bulk, "Bulk action", "milestone");
  await choose(bulk, "Bulk attribute value", "2");
  await bulk
    .getByRole("button", { name: "Apply to 2 issues", exact: true })
    .click();
  await expect(bulk).toHaveCount(0);
  for (const number of [42, 43])
    await expect(
      ui.getByRole("checkbox", {
        name: `Select yu/Arco #${number} for bulk actions`,
      }),
    ).not.toBeChecked();
  expect(calls).toBe(1);
  await expect(page.locator("#harness-error")).toBeEmpty();
});
