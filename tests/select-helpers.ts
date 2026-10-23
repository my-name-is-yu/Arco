import { expect, type FrameLocator, type Locator } from "@playwright/test";

type SelectScope = FrameLocator | Locator;

export const selectControl = (
  scope: SelectScope,
  label: string,
  exact = true,
) => scope.getByRole("group", { name: label, exact });

export async function choose(
  scope: SelectScope,
  label: string,
  value: string | { label: string },
  exact = true,
) {
  const control = selectControl(scope, label, exact);
  const trigger = control.getByRole("button");
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  const popupId = await trigger.getAttribute("aria-controls");
  expect(popupId).toBeTruthy();
  const menu = control
    .locator("xpath=ancestor::html")
    .locator(`[id=${JSON.stringify(popupId)}]`);
  const option =
    typeof value === "string"
      ? menu.locator(
          `[role="option"]:has([data-select-value=${JSON.stringify(value)}])`,
        )
      : menu.getByRole("option", { name: value.label, exact: true });
  await option.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}
