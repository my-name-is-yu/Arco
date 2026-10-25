import { expect, test } from "@playwright/test";
import { choose } from "./select-helpers";

test("an unsaved annotation comment survives a temporarily hidden range without using guessed coordinates", async ({
  page,
}) => {
  await page.goto("/?entry=project");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  const app = page.frameLocator("#arco");
  await choose(app, "GitHub view", "yu/Arco");
  const source = app.locator('[data-context-origin="comment"] p').first();
  await source.scrollIntoViewIfNeeded();
  await source.evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await app
    .getByRole("toolbar", { name: "Text selection" })
    .getByRole("button", { name: "Add to chat" })
    .click();
  const dialog = app.getByRole("dialog", {
    name: "Selection comment",
    exact: true,
  });
  const editor = dialog.getByRole("textbox", { name: "Optional comment" });
  await expect(editor).toBeFocused();
  const draft = "Keep this unsaved annotation comment";
  await editor.fill(draft);
  const contextCount = () =>
    page
      .locator("#events")
      .evaluate(
        (element) =>
          (
            JSON.parse(element.textContent ?? "[]") as { type: string }[]
          ).filter((event) => event.type === "context").length,
      );
  const before = await contextCount();
  await source.evaluate((element) => element.setAttribute("hidden", ""));
  await expect(dialog).toHaveCount(0);
  await source.evaluate((element) => element.removeAttribute("hidden"));
  await expect(editor).toHaveValue(draft);
  await expect(editor).toBeFocused();
  expect(await contextCount()).toBe(before);
  await expect(page.locator("#harness-error")).toBeEmpty();
});
