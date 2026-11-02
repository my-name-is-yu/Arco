import { expect, test } from "./browser-test";
import type { IssuePresentationSummary } from "../src/shared/launch";

test("group refresh rejects missing issues at the host boundary and recovers on request", async ({
  page,
}) => {
  let invalidate = false;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_show_issues" || !invalidate)
      return route.fallback();
    const response = await route.fetch();
    const result = (await response.json()) as {
      structuredContent: { launch: { issues?: IssuePresentationSummary[] } };
    };
    delete result.structuredContent.launch.issues;
    return route.fulfill({ response, json: result });
  });

  await page.goto("/?entry=issues");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  const ui = page.frameLocator("#arco");
  const tabs = ui.getByRole("tablist", { name: "Issues", exact: true });
  const original = [/^yu\/Arco #42 /, /^yu\/Arco #43 /];
  await expect(tabs.getByRole("tab")).toHaveText([
    "#42Preserve issue selection and scroll position",
    "#43Separate shared context from sending a request",
  ]);
  invalidate = true;
  await page
    .getByRole("button", { name: "Mock external update #42", exact: true })
    .click();
  await expect(ui.getByRole("button", { name: "Retry refresh" })).toBeVisible();
  await expect(ui.getByText(/Could not refresh issues\./)).toContainText(
    "The server returned different issue targets.",
  );
  for (const [index, name] of original.entries()) {
    await expect(tabs.getByRole("tab").nth(index)).toHaveAccessibleName(name);
  }
  await expect(tabs.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );

  invalidate = false;
  await ui.getByRole("button", { name: "Retry refresh" }).click();
  await expect(ui.getByRole("button", { name: "Retry refresh" })).toHaveCount(
    0,
  );
  await expect(tabs.getByRole("tab").first()).toHaveAccessibleName(
    "yu/Arco #42 Issue updated by a Codex tool",
  );
  await expect(tabs.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#harness-error")).toBeEmpty();
});
