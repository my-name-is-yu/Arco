import { toolFailure } from "./tool-failure";
import { expect, test } from "@playwright/test";

test(
  "invalid local settings block provider reads and can be retried without a default workspace",
  { tag: "@smoke" },
  async ({ page }) => {
    let failed = true;
    const calls: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      calls.push(input.name);
      if (failed && input.name === "arco_get_settings")
        return route.fulfill({
          json: toolFailure(
            "Local settings do not match the current format. The stored data was preserved.",
          ),
        });
      return route.continue();
    });
    await page.goto("/");
    const app = page.frameLocator("#arco");
    await expect(
      app.getByRole("heading", { name: "Could not load local settings" }),
    ).toBeVisible();
    await expect(app.getByRole("alert")).toContainText(
      "stored data was preserved",
    );
    expect(calls).toEqual(["arco_open", "arco_get_settings"]);
    await expect(app.locator(".issue-row")).toHaveCount(0);
    failed = false;
    await app.getByRole("button", { name: "Retry loading settings" }).click();
    await expect(app.locator(".issue-row").first()).toBeVisible();
    expect(calls).not.toContain("arco_update_settings");
    expect(errors).toEqual([]);
  },
);
