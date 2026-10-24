import { expect, test, type Page } from "@playwright/test";
import { choose } from "./select-helpers";

const app = (page: Page) => page.frameLocator("#arco");
async function openSource(page: Page, source: "github" | "linear") {
  await page.goto("/?entry=project");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  if (source === "linear") await choose(app(page), "Issue source", "linear");
  else await choose(app(page), "GitHub scope", "yu/Arco");
  await expect(
    app(page).getByRole("heading", {
      name:
        source === "github"
          ? "Preserve issue selection and scroll position"
          : "Keep Linear workflow states intact",
      exact: true,
    }),
  ).toBeVisible();
}
for (const source of ["github", "linear"] as const) {
  test(`${source} creation shares dismissal, keyboard submit, pending focus, and focus return`, async ({
    page,
  }, testInfo) => {
    await openSource(page, source);
    const ui = app(page);
    const open = ui.getByRole("button", {
      name: source === "github" ? "Create issue" : "Create Linear Issue",
      exact: true,
    });
    const dialog = ui.getByRole("dialog", {
      name: source === "github" ? "Create issue" : "Create Linear Issue",
      exact: true,
    });
    const closeLabel =
      source === "github" ? "Close create issue" : "Close create Linear Issue";
    await open.click();
    await dialog.getByRole("button", { name: closeLabel, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    await open.click();
    await dialog.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    await open.click();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();

    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let submitted = false;
    await page.route("**/tool", async (route) => {
      const call = route.request().postDataJSON() as { name: string };
      if (
        call.name !==
        (source === "github" ? "arco_create_issue" : "linear_create_issue")
      )
        return route.continue();
      submitted = true;
      const response = await route.fetch();
      await pending;
      return route.fulfill({ response });
    });
    try {
      await open.click();
      const title = dialog.getByRole("textbox", { name: "Title", exact: true });
      await title.fill(`Created with keyboard in ${source}`);
      await dialog.screenshot({
        path: testInfo.outputPath(`${source}-create-dialog.png`),
      });
      await title.press("Enter");
      await expect.poll(() => submitted).toBe(true);
      await expect(dialog).toHaveAttribute("aria-busy", "true");
      await expect(
        dialog.getByRole("button", { name: closeLabel, exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "Close", exact: true }),
      ).toBeDisabled();
      await dialog.press("Escape");
      await expect(dialog).toBeVisible();
      await dialog.press("Tab");
      expect(
        await dialog.evaluate((element) =>
          element.contains(element.ownerDocument.activeElement),
        ),
      ).toBe(true);
      await dialog.press("Shift+Tab");
      expect(
        await dialog.evaluate((element) =>
          element.contains(element.ownerDocument.activeElement),
        ),
      ).toBe(true);
      release();
      await expect(dialog).toBeHidden();
      await expect(open).toBeFocused();
      await expect(
        ui.getByRole("heading", {
          name: `Created with keyboard in ${source}`,
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      release();
    }
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}

test("Linear title-only conflict compares the latest title and unchanged Markdown body", async ({
  page,
}, testInfo) => {
  let sourceBody: string | undefined;
  let changed = false;
  await page.route("**/tool", async (route) => {
    const call = route.request().postDataJSON() as { name: string };
    if (call.name !== "linear_get_issue") return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    sourceBody ??= result.structuredContent.body;
    if (changed)
      Object.assign(result.structuredContent, {
        title: "Remote title changed only",
        body: sourceBody,
        updatedAt: "2026-10-24T12:00:00.000Z",
      });
    return route.fulfill({ response, json: result });
  });
  await openSource(page, "linear");
  const ui = app(page);
  const body = await ui.locator(".body-content .issue-markdown").innerText();
  await ui.locator(".detail-utilities > summary").click();
  await ui
    .getByRole("button", { name: "Edit Linear description", exact: true })
    .click();
  await ui
    .getByRole("textbox", { name: "Linear title", exact: true })
    .fill("My unsent title");
  changed = true;
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  await expect(
    ui.getByRole("button", { name: "Save to Linear", exact: true }),
  ).toBeDisabled();
  await ui
    .getByRole("button", { name: "Compare latest content", exact: true })
    .click();
  await ui
    .getByRole("alert", { name: "Content conflict", exact: true })
    .screenshot({ path: testInfo.outputPath("linear-title-conflict.png") });
  await expect(ui.locator(".latest-content > strong")).toHaveText(
    "Remote title changed only",
  );
  await expect(ui.locator(".latest-content .issue-markdown")).toHaveText(body);
  await expect(
    ui.getByRole("textbox", { name: "Linear title", exact: true }),
  ).toHaveValue("My unsent title");
  await expect(page.locator("#harness-error")).toBeEmpty();
});
