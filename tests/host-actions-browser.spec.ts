import { expect, test } from "./browser-test";

for (const source of ["github", "linear"] as const) {
  for (const interaction of [
    "Escape",
    "another control",
    "the host",
    "rejection",
  ] as const) {
    test(`${source} delayed clipboard ${interaction} preserves the newer focus`, async ({
      page,
    }) => {
      await page.goto(`/?entry=detail&source=${source}&number=42`);
      const ui = page.frameLocator("#arco");
      const menu = ui.locator(".detail-utilities");
      const actions = menu.locator("summary");
      const copy = menu.locator(".copy-value button").first();
      const destination =
        interaction === "the host"
          ? page.getByRole("textbox", {
              name: "Mock @Arco search",
              exact: true,
            })
          : ui.getByRole("textbox", {
              name:
                source === "github" ? "Search issues" : "Search Linear Issues",
              exact: true,
            });
      await expect(actions).toBeVisible();
      await ui.locator("body").evaluate(() => {
        const pending = new Promise<void>((resolve, reject) => {
          document.addEventListener("fixture-copy-complete", () => resolve(), {
            once: true,
          });
          document.addEventListener(
            "fixture-copy-reject",
            () => reject(new Error("Clipboard denied")),
            { once: true },
          );
        });
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: () => pending },
        });
      });
      await actions.click();
      await copy.click();
      if (interaction === "Escape") await page.keyboard.press("Escape");
      await destination.focus();
      await ui.locator("body").evaluate((_element, rejected) => {
        document.dispatchEvent(
          new Event(rejected ? "fixture-copy-reject" : "fixture-copy-complete"),
        );
      }, interaction === "rejection");
      if (interaction === "rejection") {
        await expect(menu.locator(".manual-copy input")).toHaveValue(
          source === "github"
            ? "https://github.com/yu/Arco/issues/42"
            : "YU-42 https://linear.app/fixture/issue/YU-42",
        );
      } else {
        await expect(copy).toHaveText("Copied");
      }
      await expect(destination).toBeFocused();
      expect(
        await destination.evaluate(
          (element) => element.ownerDocument.activeElement === element,
        ),
      ).toBe(true);
      if (interaction === "Escape")
        await expect(menu).toHaveJSProperty("open", false);
      await expect(page.locator("#harness-error")).toBeEmpty();
    });
  }
}

test("a rejected GitHub related-issue link uses the existing host-action notice", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    window.addEventListener(
      "message",
      (event) => {
        if (event.data?.method !== "ui/open-link") return;
        event.stopImmediatePropagation();
        document
          .querySelector<HTMLIFrameElement>("#arco")
          ?.contentWindow?.postMessage(
            {
              jsonrpc: "2.0",
              id: event.data.id,
              error: {
                code: -32000,
                message: "The host could not open this link.",
              },
            },
            "*",
          );
      },
      true,
    );
  });
  await page.route("**/tool", async (route) => {
    if (route.request().postDataJSON().name !== "arco_issue_relations")
      return route.continue();
    return route.fulfill({
      json: {
        structuredContent: {
          repo: "yu/Arco",
          number: 42,
          parent: {
            id: 43,
            repo: "yu/Arco",
            number: 43,
            title: "Related fixture issue",
            state: "open",
            url: "https://github.com/yu/Arco/issues/43",
          },
          children: [],
          blockedBy: [],
          blocking: [],
          errors: [],
        },
      },
    });
  });
  await page.goto("/?entry=detail&issueRepo=yu/Arco&number=42");
  const ui = page.frameLocator("#arco");
  await ui.getByText("More properties", { exact: true }).click();
  const relations = ui.locator(".relations-manager");
  await relations.locator("summary").first().click();
  await relations
    .getByRole("button", {
      name: "yu/Arco #43 · Related fixture issue ↗",
      exact: true,
    })
    .click();
  await expect(ui.locator(".notice.error")).toContainText(
    "The host could not open this link.",
  );
  expect(errors).toEqual([]);
  await expect(page.locator("#harness-error")).toBeEmpty();
});
