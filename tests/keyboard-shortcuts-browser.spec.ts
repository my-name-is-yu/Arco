import { expect, test, type Page } from "./browser-test";
import { choose } from "./select-helpers";
import type { NativeIssueTarget } from "../src/shared/launch";

const app = (page: Page) => page.frameLocator("#arco");
const githubTitles = [
  "Preserve issue selection and scroll position",
  "Separate shared context from sending a request",
];
const linearTitles = [
  "Keep Linear workflow states intact",
  "Share a Linear issue with the Codex chat",
];
const targets: NativeIssueTarget[] = [
  { source: "github", repo: "yu/Arco", number: 42 },
  { source: "github", repo: "yu/Arco", number: 43 },
  ...[42, 43].map((number) => ({
    source: "linear" as const,
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-linear-team",
    issueId: `fixture-linear-${number}`,
  })),
];

async function ready(page: Page) {
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await expect(page.locator("#harness-error")).toBeEmpty();
}
async function openInline(page: Page) {
  const query = new URLSearchParams({
    entry: "issues",
    targets: JSON.stringify(targets),
  });
  await page.goto(`/?${query}`);
  await ready(page);
  await expectTitle(page, githubTitles[0]);
  await expect(app(page).getByRole("tab")).toHaveCount(4);
}
async function openWorkspace(page: Page, source = "github") {
  await page.goto(source === "github" ? "/?entry=project" : "/?source=linear");
  await ready(page);
  if (source === "github") await choose(app(page), "GitHub view", "yu/Arco");
  await expectTitle(
    page,
    (source === "github" ? githubTitles : linearTitles)[0],
  );
}
async function expectTitle(page: Page, title: string) {
  await expect(
    app(page).getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
}
async function events(page: Page, type: string) {
  const log = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  ) as {
    type: string;
    value: unknown;
  }[];
  return log.filter((event) => event.type === type).map((event) => event.value);
}
async function expectNoSharing(page: Page) {
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
}
async function openMenu(page: Page) {
  await app(page).getByLabel("Issue actions", { exact: true }).click();
}
function settingsSaved(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith("/tool") &&
      response.request().postDataJSON()?.name === "arco_update_settings" &&
      response.ok(),
  );
}

test("j/k reads all mixed-provider inline issues cyclically without opening or sharing", async ({
  page,
}) => {
  await openInline(page);
  await app(page)
    .getByRole("region", { name: "Issue description text", exact: true })
    .focus();
  for (const title of [
    ...githubTitles.slice(1),
    ...linearTitles,
    githubTitles[0],
  ]) {
    await page.keyboard.press("j");
    await expectTitle(page, title);
  }
  await page.keyboard.press("k");
  await expectTitle(page, linearTitles[1]);
  await expect(app(page).getByRole("tab").last()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await events(page, "display-request")).toEqual([]);
  await expectNoSharing(page);
});

for (const source of ["github", "linear"] as const) {
  test(`${source} navigation stops at list boundaries and G then I restores list focus`, async ({
    page,
  }) => {
    await openWorkspace(page, source);
    const ui = app(page);
    const rows = ui.locator(".issue-list .issue-row");
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);
    await expect(
      ui.getByRole("button", { name: "Previous issue", exact: true }),
    ).toBeDisabled();
    await expect(
      ui.getByRole("button", { name: "Next issue", exact: true }),
    ).toBeEnabled();

    await page.setViewportSize({ width: 1440, height: 600 });
    const detail = ui.locator(".detail-scroll");
    const draft = ui.getByRole("textbox", {
      name: source === "github" ? "Comment on GitHub" : "Linear comment",
      exact: true,
    });
    const draftText = `${source} draft survives keyboard issue navigation.`;
    await draft.fill(draftText);
    await detail.focus();
    const readingPosition = await detail.evaluate((element) => {
      element.scrollTop = 160;
      return element.scrollTop;
    });
    expect(readingPosition).toBeGreaterThan(0);
    await page.keyboard.press("j");
    await expectTitle(
      page,
      (source === "github" ? githubTitles : linearTitles)[1],
    );
    await page.keyboard.press("k");
    await expectTitle(
      page,
      (source === "github" ? githubTitles : linearTitles)[0],
    );
    await expect(draft).toHaveValue(draftText);
    await expect
      .poll(() => detail.evaluate((element) => element.scrollTop))
      .toBe(readingPosition);

    await rows.first().click();
    await page.keyboard.press("k");
    await expect(rows.first()).toHaveClass(/selected/);
    for (let index = 1; index < count; index++) {
      await page.keyboard.press("j");
      await expect(rows.nth(index)).toHaveClass(/selected/);
    }
    await page.keyboard.press("j");
    await expect(rows.last()).toHaveClass(/selected/);
    await expect(
      ui.getByRole("button", { name: "Next issue", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(rows.last()).toBeFocused();
    await page.keyboard.press("/");
    const search = ui.getByRole("textbox", {
      name: source === "github" ? "Search issues" : "Search Linear Issues",
      exact: true,
    });
    await expect(search).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await rows.last().click();
    await expect(ui.locator(".issue-sidebar")).toBeHidden();
    await ui.locator(".detail-pane h1").click();
    await page.keyboard.press("Escape");
    await expect(ui.locator(".issue-sidebar")).toBeHidden();
    await expect(ui.locator(".detail-pane")).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(ui.locator(".issue-sidebar")).toBeVisible();
    await expect(rows.last()).toBeFocused();

    await rows.first().click();
    await detail.focus();
    const narrowReadingPosition = await detail.evaluate((element) => {
      element.scrollTop = 160;
      return element.scrollTop;
    });
    expect(narrowReadingPosition).toBeGreaterThan(0);
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press("j");
    await expectTitle(
      page,
      (source === "github" ? githubTitles : linearTitles)[1],
    );
    await expect(ui.locator(".issue-sidebar")).toBeHidden();
    await expect(ui.locator(".detail-scroll")).toBeFocused();
    await page.keyboard.press("k");
    await expectTitle(
      page,
      (source === "github" ? githubTitles : linearTitles)[0],
    );
    await expect(ui.locator(".detail-scroll")).toBeFocused();
    await expect
      .poll(() => detail.evaluate((element) => element.scrollTop))
      .toBe(narrowReadingPosition);
    await expectNoSharing(page);
  });

  test(`${source} a delayed issue load preserves focus after the reader moves to search`, async ({
    page,
  }) => {
    await openWorkspace(page, source);
    const ui = app(page);
    const detailTool =
      source === "github" ? "arco_get_issue" : "linear_get_issue";
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { number?: number; issueId?: string };
      };
      if (
        input.name === detailTool &&
        (input.arguments.number === 43 ||
          input.arguments.issueId === "fixture-linear-43")
      ) {
        markEntered();
        await held;
      }
      await route.continue();
    });
    try {
      await ui
        .getByRole("heading", {
          name: (source === "github" ? githubTitles : linearTitles)[0],
          exact: true,
        })
        .click();
      await page.keyboard.press("j");
      await entered;
      const search = ui.getByRole("textbox", {
        name: source === "github" ? "Search issues" : "Search Linear Issues",
        exact: true,
      });
      await search.click();
      await expect(search).toBeFocused();
      release();
      await expectTitle(
        page,
        (source === "github" ? githubTitles : linearTitles)[1],
      );
      await expect(search).toBeFocused();
      await expectNoSharing(page);
    } finally {
      release();
    }
  });
}

test("a delayed issue load returns focus to the reading area when navigation continues", async ({
  page,
}) => {
  await openWorkspace(page);
  const ui = app(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { number?: number };
    };
    if (input.name === "arco_get_issue" && input.arguments.number === 43) {
      markEntered();
      await held;
    }
    await route.continue();
  });
  try {
    await ui
      .getByRole("heading", { name: githubTitles[0], exact: true })
      .click();
    await page.keyboard.press("j");
    await entered;
    await expect(ui.locator('[data-loading-skeleton="detail"]')).toBeVisible();
    release();
    await expectTitle(page, githubTitles[1]);
    await expect(ui.locator(".detail-scroll")).toBeFocused();
    await page.keyboard.press("k");
    await expectTitle(page, githubTitles[0]);
    await expect(ui.locator(".detail-scroll")).toBeFocused();
    await expectNoSharing(page);
  } finally {
    release();
  }
});

test("character shortcuts leave text entry, IME, selections, and menus to their own controls", async ({
  page,
}) => {
  await openWorkspace(page);
  const ui = app(page);
  const comment = ui.getByRole("textbox", {
    name: "Comment on GitHub",
    exact: true,
  });
  await comment.fill("Typing ");
  await comment.pressSequentially("jk/gi?");
  await expect(comment).toHaveValue("Typing jk/gi?");
  await expectTitle(page, githubTitles[0]);
  await expect(
    ui.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeHidden();

  const heading = ui.getByRole("heading", {
    name: githubTitles[0],
    exact: true,
  });
  await heading.click();
  await heading.dispatchEvent("keydown", {
    key: "j",
    code: "KeyJ",
    isComposing: true,
    keyCode: 229,
  });
  await expectTitle(page, githubTitles[0]);
  await ui
    .locator(".issue-body p")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await page.keyboard.press("j");
  await expectTitle(page, githubTitles[0]);
  await page.keyboard.press("Escape");
  await openMenu(page);
  for (const key of ["j", "k", "/", "?", "g", "i"])
    await page.keyboard.press(key);
  await expect(ui.locator("details.detail-utilities")).toHaveAttribute(
    "open",
    "",
  );
  await expectTitle(page, githubTitles[0]);
  await page.keyboard.press("Escape");
  await expect(ui.getByLabel("Issue actions", { exact: true })).toBeFocused();
  await expect(ui.locator(".detail-pane")).toBeVisible();
  await expectNoSharing(page);
});

test("G sequence expires and is cancelled by other keys, focus moves, and leaving Arco", async ({
  page,
}) => {
  await page.clock.install();
  await openInline(page);
  const body = app(page).getByRole("region", {
    name: "Issue description text",
    exact: true,
  });
  const tabs = app(page).getByRole("tablist", { name: "Issues", exact: true });
  await body.focus();
  await page.keyboard.press("g");
  await page.keyboard.press("Escape");
  await page.keyboard.press("i");
  await expect(tabs).toBeVisible();
  expect(await events(page, "display-request")).toEqual([]);
  await page.keyboard.press("g");
  await page.clock.fastForward(1100);
  await page.keyboard.press("i");
  await expect(tabs).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("x");
  await page.keyboard.press("i");
  await expect(tabs).toBeVisible();
  await page.keyboard.press("g");
  await body.click();
  await page.keyboard.press("i");
  await expect(tabs).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("Tab");
  await body.focus();
  await page.keyboard.press("i");
  await expect(tabs).toBeVisible();
  await page.keyboard.press("g");
  await page
    .getByRole("textbox", { name: "Mock @Arco search", exact: true })
    .focus();
  await page.keyboard.press("j");
  await page.keyboard.press("?");
  await expectTitle(page, githubTitles[0]);
  await body.focus();
  await page.keyboard.press("i");
  await expect(tabs).toBeVisible();
  expect(await events(page, "display-request")).toEqual([]);
  await page.keyboard.press("g");
  await page.keyboard.press("i");
  await expect(app(page).locator(".workspace")).toBeVisible();
  await expect(app(page).locator(".issue-sidebar")).toBeVisible();
  await expect(app(page).locator(".issue-list:focus-within")).toBeVisible();
  await expectNoSharing(page);
});

test("character shortcut preference survives reload while help stays reachable by click", async ({
  page,
}) => {
  await openWorkspace(page);
  const ui = app(page);
  await ui.getByRole("heading", { name: githubTitles[0], exact: true }).click();
  await page.keyboard.press("?");
  const dialog = ui.getByRole("dialog", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  const toggle = dialog.getByRole("checkbox", {
    name: "Enable keyboard shortcuts",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(toggle).toBeChecked();
  const listHint = dialog
    .locator(".shortcut-help-row")
    .filter({ hasText: "Go to issue list" });
  await expect(listHint.locator("kbd")).toHaveText(["G", "I"]);
  await expect(listHint.getByText("then", { exact: true })).toBeVisible();
  const disabledSaved = settingsSaved(page);
  await toggle.click();
  await disabledSaved;
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");
  await ui.getByRole("heading", { name: githubTitles[0], exact: true }).click();
  for (const key of ["j", "/", "?", "g", "i"]) await page.keyboard.press(key);
  await expectTitle(page, githubTitles[0]);
  await expect(dialog).toBeHidden();
  await expect(ui.locator(".search-control kbd")).toHaveCount(0);
  const next = ui.getByRole("button", { name: "Next issue", exact: true });
  await next.hover();
  await expect(ui.getByRole("tooltip")).toContainText("Next issue");
  await expect(ui.getByRole("tooltip").locator("kbd")).toHaveCount(0);
  await next.click();
  await expectTitle(page, githubTitles[1]);
  await ui.getByRole("button", { name: "Previous issue", exact: true }).click();
  await expectTitle(page, githubTitles[0]);
  await expectNoSharing(page);

  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await expectTitle(page, githubTitles[0]);
  await ui
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  await expect(toggle).not.toBeChecked();
  const enabledSaved = settingsSaved(page);
  await toggle.click();
  await enabledSaved;
  await expect(toggle).toBeChecked();
  await page.keyboard.press("Escape");
  await ui.getByRole("heading", { name: githubTitles[0], exact: true }).click();
  await page.keyboard.press("j");
  await expectTitle(page, githubTitles[1]);
});

test("standard tab navigation remains available when character shortcuts are disabled", async ({
  page,
}) => {
  await openInline(page);
  await openMenu(page);
  await app(page)
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  const saved = settingsSaved(page);
  await app(page)
    .getByRole("checkbox", { name: "Enable keyboard shortcuts", exact: true })
    .click();
  await saved;
  await expect(
    app(page).getByRole("checkbox", {
      name: "Enable keyboard shortcuts",
      exact: true,
    }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  const tabs = app(page).getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expectTitle(page, githubTitles[1]);
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await expectTitle(page, linearTitles[1]);
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("j");
  await expectTitle(page, githubTitles[0]);
  await app(page)
    .getByRole("button", { name: "Previous issue", exact: true })
    .click();
  await expectTitle(page, linearTitles[1]);
  await app(page)
    .getByRole("button", { name: "Next issue", exact: true })
    .click();
  await expectTitle(page, githubTitles[0]);
  expect(await events(page, "display-request")).toEqual([]);
  await expectNoSharing(page);
});

test("saving the shortcut preference keeps help keyboard focus and Escape usable", async ({
  page,
}) => {
  await openWorkspace(page);
  const ui = app(page);
  await ui
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  const dialog = ui.getByRole("dialog", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  const toggle = dialog.getByRole("checkbox", {
    name: "Enable keyboard shortcuts",
    exact: true,
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  await page.route("**/tool", async (route) => {
    if (route.request().postDataJSON().name === "arco_update_settings") {
      markEntered();
      await held;
    }
    await route.continue();
  });
  try {
    const saved = settingsSaved(page);
    await toggle.click();
    await entered;
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", {
        name: "Close keyboard shortcuts",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      ui.getByRole("button", { name: "Keyboard shortcuts", exact: true }),
    ).toBeFocused();
    await expectTitle(page, githubTitles[0]);
    release();
    await saved;
    await ui
      .getByRole("button", { name: "Keyboard shortcuts", exact: true })
      .click();
    await expect(toggle).not.toBeChecked();
    await expectNoSharing(page);
  } finally {
    release();
  }
});

test("shortcut hints expose labels and keycaps through hover, focus, and menus", async ({
  page,
}, testInfo) => {
  await openWorkspace(page);
  const ui = app(page);
  const help = ui.getByRole("button", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  await help.hover();
  const tooltip = ui.getByRole("tooltip");
  await expect(tooltip).toContainText("Keyboard shortcuts");
  await expect(tooltip.locator("kbd")).toHaveText("?");
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();
  await help.focus();
  await expect(tooltip).toContainText("Keyboard shortcuts");
  await expect(tooltip.locator("kbd")).toHaveText("?");
  await page.screenshot({
    path: testInfo.outputPath("shortcut-tooltip.png"),
    animations: "disabled",
  });
  await ui.getByRole("heading", { name: githubTitles[0], exact: true }).click();
  await ui.getByRole("button", { name: "Next issue", exact: true }).hover();
  await expect(tooltip).toContainText("Next issue");
  await expect(tooltip.locator("kbd")).toHaveText("J");
  await openMenu(page);
  const menu = ui.locator(".detail-utility-menu");
  await expect(
    menu.getByRole("button", { name: "Next issue", exact: true }),
  ).toHaveCount(0);
  const list = menu.getByRole("button", {
    name: "Go to issue list",
    exact: true,
  });
  await expect(list.locator("kbd")).toHaveText(["G", "I"]);
  await expect(list.getByText("then", { exact: true })).toBeVisible();
  await ui
    .locator(".detail-utility-menu")
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  const dialog = ui.getByRole("dialog", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", {
    name: "Close keyboard shortcuts",
    exact: true,
  });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("checkbox", { name: "Enable keyboard shortcuts" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("j");
  await expectTitle(page, githubTitles[0]);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({
    path: testInfo.outputPath("shortcut-help-narrow.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
