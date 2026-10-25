import { toolFailure } from "./tool-failure";
import { expect, test } from "@playwright/test";

for (const invalidSuccess of [false, true])
  test(
    invalidSuccess
      ? "malformed settings responses show recovery guidance and block provider reads without automatic writes"
      : "invalid local settings block provider reads and can be retried without a default workspace",
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
            json: invalidSuccess
              ? {
                  structuredContent: {
                    revision: "private-schema-value",
                    settings: { privateField: "private-response-value" },
                  },
                }
              : toolFailure(
                  "Your saved settings could not be opened. They have been kept unchanged.",
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
        invalidSuccess
          ? "Could not read the saved settings. Reopen Arco and try again."
          : "They have been kept unchanged.",
      );
      await expect(app.getByRole("alert")).not.toContainText("private-");
      expect(calls).toEqual(["arco_open", "arco_get_settings"]);
      await expect(app.locator(".issue-row")).toHaveCount(0);
      failed = false;
      await app.getByRole("button", { name: "Retry loading settings" }).click();
      await expect(app.locator(".issue-row").first()).toBeVisible();
      expect(calls).not.toContain("arco_update_settings");
      expect(errors).toEqual([]);
    },
  );
