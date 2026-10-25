import { expect, test } from "@playwright/test";
import { choose, selectControl } from "./select-helpers";

test("Linear template links keep the workspace notice boundary through rejection and retry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    let rejectNextLink = true;
    window.addEventListener(
      "message",
      (event) => {
        if (event.data?.method !== "ui/open-link" || !rejectNextLink) return;
        rejectNextLink = false;
        event.stopImmediatePropagation();
        document
          .querySelector<HTMLIFrameElement>("#arco")
          ?.contentWindow?.postMessage(
            {
              jsonrpc: "2.0",
              id: event.data.id,
              error: {
                code: -32000,
                message: "The host could not open this Linear template.",
              },
            },
            "*",
          );
      },
      true,
    );
  });
  await page.goto("/?entry=detail&source=linear&number=42");
  const ui = page.frameLocator("#arco");
  await ui
    .getByRole("button", { name: "Create Linear Issue", exact: true })
    .click();
  const dialog = ui.getByRole("dialog", { name: "Create Linear Issue" });
  await choose(dialog, "Linear template", "linear-form-template");
  const open = dialog.getByRole("button", {
    name: "Open Linear to use this template",
    exact: false,
  });
  await open.click();
  await expect(dialog.locator(".notice.error")).toContainText(
    "The host could not open this Linear template.",
  );
  await expect(dialog).toBeVisible();
  await expect(selectControl(dialog, "Linear template")).toHaveAttribute(
    "data-value",
    "linear-form-template",
  );
  await open.click();
  await expect(dialog.locator(".notice")).toHaveCount(0);
  await expect
    .poll(async () => {
      const events: { type: string; value: unknown }[] = JSON.parse(
        (await page.locator("#events").textContent()) ?? "[]",
      );
      return events
        .filter((event) => event.type === "link")
        .map((event) => event.value);
    })
    .toEqual([
      {
        url: "https://linear.app/new?team=fixture-linear-team&template=linear-form-template",
      },
    ]);
  await expect(
    dialog.getByRole("button", { name: "Create in Linear", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
  await expect(page.locator("#harness-error")).toBeEmpty();
});
