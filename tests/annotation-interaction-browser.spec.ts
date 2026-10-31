import { expect, test, type FrameLocator, type Page } from "./browser-test";
import { choose } from "./select-helpers";
import { toolFailure } from "./tool-failure";

const dialog = (app: FrameLocator) =>
  app.getByRole("dialog", { name: "Selection comment", exact: true });
const editor = (app: FrameLocator) =>
  dialog(app).getByRole("textbox", { name: "Optional comment" });
const marker = (app: FrameLocator, number: number) =>
  app.getByRole("button", {
    name: `Edit selection comment ${number}`,
    exact: true,
  });

async function add(app: FrameLocator, selector = ".issue-heading h1") {
  const source = app.locator(selector).first();
  await source.scrollIntoViewIfNeeded();
  await source.evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const range = document.createRange();
    range.selectNodeContents(element);
    const selected = window.getSelection()!;
    selected.removeAllRanges();
    selected.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await app
    .getByRole("toolbar", { name: "Text selection", exact: true })
    .getByRole("button", { name: "Add to chat", exact: true })
    .click();
  await expect(editor(app)).toBeFocused();
}

async function contexts(page: Page) {
  return page.locator("#events").evaluate((element) => {
    const events = JSON.parse(element.textContent ?? "[]") as {
      type: string;
      value: unknown;
    }[];
    return events
      .filter((event) => event.type === "context")
      .map((event) => event.value);
  });
}

async function highlights(app: FrameLocator) {
  return app.locator("body").evaluate(() => {
    return Array.from(CSS.highlights.get("arco-selection") ?? []).length;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?entry=project");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await choose(page.frameLocator("#arco"), "GitHub view", "yu/Arco");
  await expect(page.locator("#harness-error")).toBeEmpty();
});

test("new and reopened annotations use separate editors and only highlight the active passage", async ({
  page,
}) => {
  const app = page.frameLocator("#arco");
  await add(app);
  await expect.poll(() => contexts(page)).toHaveLength(1);
  await expect(dialog(app).getByRole("button")).toHaveCount(1);
  await expect.poll(() => highlights(app)).toBe(1);
  await editor(app).fill("First line");
  await editor(app).press("Enter");
  await editor(app).press("End");
  await editor(app).press("Control+Enter");
  await expect(dialog(app)).toHaveCount(0);
  await expect.poll(() => contexts(page)).toHaveLength(2);
  await expect.poll(() => highlights(app)).toBe(0);
  await expect(marker(app, 1)).toBeVisible();
  await marker(app, 1).click();
  await expect(
    dialog(app).getByRole("button", { name: "Cancel" }),
  ).toBeVisible();
  await expect(
    dialog(app).getByRole("button", { name: "Remove annotation 1" }),
  ).toBeVisible();
  await expect(editor(app)).toHaveValue("First line\n");
  await editor(app).fill("Discard this edit");
  await dialog(app).getByRole("button", { name: "Cancel" }).click();
  await marker(app, 1).click();
  await expect(editor(app)).toHaveValue("First line\n");
  await editor(app).press("Escape");
  await expect.poll(() => contexts(page)).toHaveLength(2);
});

test("new dirty comments resist outside clicks while empty new and reopened editors close", async ({
  page,
}) => {
  const app = page.frameLocator("#arco");
  await add(app);
  const heading = app.locator(".issue-heading h1");
  await heading.click();
  await expect(dialog(app)).toHaveCount(0);
  await expect(marker(app, 1)).toBeVisible();
  await add(app, ".issue-body p");
  await editor(app).fill("Keep this unfinished comment");
  await heading.click();
  await expect(editor(app)).toHaveValue("Keep this unfinished comment");
  await expect(editor(app)).toBeFocused();
  await expect.poll(() => contexts(page)).toHaveLength(2);
  await editor(app).press("Escape");
  await expect(dialog(app)).toHaveCount(0);
  await marker(app, 2).click();
  await expect(editor(app)).toHaveValue("");
  await editor(app).fill("Discard this reopened edit");
  await heading.click();
  await expect(dialog(app)).toHaveCount(0);
  await marker(app, 2).click();
  await expect(editor(app)).toHaveValue("");
});

for (const concealed of ["hidden", "offscreen"] as const) {
  test(`a ${concealed} dirty annotation leaves unrelated controls usable and restores its draft`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 640 });
    const app = page.frameLocator("#arco");
    const selector =
      concealed === "hidden"
        ? '[data-context-origin="comment"] p'
        : ".issue-heading h1";
    await add(app, selector);
    const draft = "Keep this unfinished annotation while browsing";
    await editor(app).fill(draft);
    const source = app.locator(selector).first();
    await source.evaluate((element, concealed) => {
      if (concealed === "hidden") element.setAttribute("hidden", "");
      else {
        const scroll = element.closest(".detail-scroll")!;
        scroll.scrollTop = scroll.scrollHeight;
      }
    }, concealed);
    await expect(dialog(app)).toHaveCount(0);
    const unrelated = app.getByRole("checkbox", {
      name: "Select yu/Arco #42 for bulk actions",
      exact: true,
    });
    await unrelated.click();
    await expect(unrelated).toBeChecked();
    await unrelated.click();
    await expect(unrelated).not.toBeChecked();
    if (concealed === "hidden")
      await source.evaluate((element) => element.removeAttribute("hidden"));
    await source.scrollIntoViewIfNeeded();
    await expect(editor(app)).toHaveValue(draft);
    await expect(editor(app)).toBeFocused();
    await expect.poll(() => contexts(page)).toHaveLength(1);
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}

test("annotation ordinals close gaps while the retained marker keeps its original action identity", async ({
  page,
}) => {
  const app = page.frameLocator("#arco");
  await add(app);
  await editor(app).press("Escape");
  await add(app, ".issue-body p");
  await editor(app).press("Escape");
  await marker(app, 1).click();
  await dialog(app)
    .getByRole("button", { name: "Remove annotation 1", exact: true })
    .click();
  await expect(marker(app, 1)).toHaveText("1");
  await expect(app.locator("[data-arco-annotation='2']")).toHaveCount(1);
  await expect(app.locator("[data-arco-annotation='1']")).toHaveCount(0);
  await marker(app, 1).click();
  await editor(app).fill("The retained second passage");
  await editor(app).press("Meta+Enter");
  await expect(dialog(app)).toHaveCount(0);
  await marker(app, 1).click();
  await expect(editor(app)).toHaveValue("The retained second passage");
});

test("keyboard save ignores composition, repeats and extra modifiers, and failure retains the draft until host removal", async ({
  page,
}) => {
  const app = page.frameLocator("#arco");
  await add(app);
  await editor(app).fill("Keep after a failed save");
  await editor(app).evaluate((element) => {
    for (const options of [
      { metaKey: true, isComposing: true },
      { ctrlKey: true, repeat: true },
      { ctrlKey: true, shiftKey: true },
      { ctrlKey: true, altKey: true },
    ])
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      );
  });
  await expect.poll(() => contexts(page)).toHaveLength(1);
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_write_annotation_snapshot")
      return route.fallback();
    await route.fulfill({
      json: toolFailure("Annotation position save failed"),
    });
  });
  await editor(app).press("Control+Enter");
  await expect(dialog(app).getByRole("alert")).toHaveText(
    "Annotation position save failed",
  );
  await expect(editor(app)).toHaveValue("Keep after a failed save");
  await page.evaluate(() => {
    document
      .querySelector<HTMLIFrameElement>("#arco")!
      .contentWindow!.postMessage(
        {
          jsonrpc: "2.0",
          method: "ui/notifications/host-context-changed",
          params: { "openai/modelContext": null },
        },
        "*",
      );
  });
  await expect(dialog(app)).toHaveCount(0);
  await expect(marker(app, 1)).toHaveCount(0);
  await expect.poll(() => highlights(app)).toBe(0);
  await expect.poll(() => contexts(page)).toHaveLength(1);
});

test("narrow reopened editors fit their measured height and click-away feedback honors reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const app = page.frameLocator("#arco");
  await app.locator(".issue-row").first().click();
  await add(app);
  await editor(app).fill("Unfinished comment");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await app.locator(".issue-heading h1").click();
  await expect(editor(app)).toBeFocused();
  expect(
    await dialog(app).evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
  ).toBe("none");
  await editor(app).press("Escape");
  await marker(app, 1).click();
  await editor(app).fill("A long comment\n".repeat(9));
  const bounds = await dialog(app).evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
  await expect(
    dialog(app).getByRole("button", { name: "Save comment" }),
  ).toBeVisible();
});
