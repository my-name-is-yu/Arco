import { toolFailure } from "./tool-failure";
import { expect, test, type Page } from "./browser-test";
import { choose } from "./select-helpers";

const githubTitle = "Preserve issue selection and scroll position";
const linearTitle = "Keep Linear workflow states intact";
const app = (page: Page) => page.frameLocator("#arco");
const skeleton = (page: Page, kind?: string) =>
  app(page).locator(
    kind ? `[data-loading-skeleton="${kind}"]` : "[data-loading-skeleton]",
  );

function gate() {
  let release!: () => void;
  let markEntered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  return {
    entered,
    release,
    async wait() {
      markEntered();
      await held;
    },
  };
}

async function openGithub(page: Page) {
  await page.goto("/");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await expect(
    app(page).getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      document.documentElement.dataset.motionCspViolations = JSON.stringify([
        ...JSON.parse(
          document.documentElement.dataset.motionCspViolations ?? "[]",
        ),
        event.effectiveDirective,
      ]);
    });
  });
});

test.afterEach(async ({ page }, info) => {
  const violations = await Promise.all(
    page
      .frames()
      .map((frame) =>
        frame.evaluate(() =>
          JSON.parse(
            document.documentElement.dataset.motionCspViolations ?? "[]",
          ),
        ),
      ),
  );
  await info.attach("loading-motion-host-events", {
    body: (await page.locator("#events").textContent()) ?? "[]",
    contentType: "application/json",
  });
  expect(violations.flat()).toEqual([]);
  expect(errors.get(page)).toEqual([]);
  await expect(page.locator("#harness-error")).toBeEmpty();
});

test("the HTML bootstrap already paints a fullscreen skeleton before JavaScript runs", async ({
  browser,
  page,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const staticPage = await context.newPage();
    await staticPage.goto("http://127.0.0.1:4174/arco.html");
    const boot = staticPage.locator('[data-loading-skeleton="workspace"]');
    await expect(boot).toBeVisible();
    await expect(boot).toHaveAttribute("aria-busy", "true");
    await expect(staticPage.getByText("Connecting Arco…")).toHaveCount(0);
    const bounds = await boot.boundingBox();
    expect(bounds?.width).toBeGreaterThan(1000);
    expect(bounds?.height).toBeGreaterThan(600);
    await staticPage.setViewportSize({ width: 390, height: 180 });
    expect((await boot.boundingBox())?.height).toBeLessThanOrEqual(180);
    expect(
      await staticPage
        .locator("html")
        .evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(390);
  } finally {
    await context.close();
  }
  // Keep the shared runtime/CSP checks attached to a normal mock host.
  await openGithub(page);
});

test("GitHub startup progresses from the workspace to list and detail skeletons without false empty states", async ({
  page,
}) => {
  const settings = gate();
  const connection = gate();
  const list = gate();
  const detail = gate();
  let connectionRequested = false;
  const gates: Record<string, ReturnType<typeof gate>> = {
    arco_get_settings: settings,
    arco_connection: connection,
    arco_account_issues: list,
    arco_get_issue: detail,
  };
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "arco_connection") connectionRequested = true;
    await gates[input.name]?.wait();
    await route.continue();
  });
  try {
    await page.goto("/");
    await settings.entered;
    await expect(skeleton(page, "workspace")).toBeVisible();
    await expect(skeleton(page, "workspace")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(connectionRequested).toBe(false);
    settings.release();
    await connection.entered;
    await expect(skeleton(page, "workspace")).toBeVisible();
    connection.release();
    await list.entered;
    await expect(skeleton(page, "workspace")).toHaveCount(0);
    await expect(skeleton(page, "list")).toBeVisible();
    await expect(skeleton(page, "detail")).toBeVisible();
    await expect(
      app(page).getByRole("heading", { name: "No matching issues" }),
    ).toHaveCount(0);
    await expect(
      app(page).getByRole("heading", {
        name: "Start a conversation with an issue",
      }),
    ).toHaveCount(0);
    list.release();
    await detail.entered;
    await expect(app(page).locator(".issue-row").first()).toBeVisible();
    await expect(skeleton(page, "list")).toHaveCount(0);
    await expect(skeleton(page, "detail")).toBeVisible();
    detail.release();
    await expect(
      app(page).getByRole("heading", { name: githubTitle, exact: true }),
    ).toBeVisible();
    await expect(skeleton(page)).toHaveCount(0);
  } finally {
    Object.values(gates).forEach((pending) => pending.release());
  }
});

test("Linear waits for connection and scopes before showing provider content, then loads list and detail independently", async ({
  page,
}) => {
  await openGithub(page);
  const connection = gate();
  const scopes = gate();
  const list = gate();
  const detail = gate();
  const gates: Record<string, ReturnType<typeof gate>> = {
    linear_connection: connection,
    linear_scopes: scopes,
    linear_list_issues: list,
    linear_get_issue: detail,
  };
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    await gates[input.name]?.wait();
    await route.continue();
  });
  try {
    await app(page)
      .getByRole("group", { name: "Issue source", exact: true })
      .getByRole("button")
      .click();
    await app(page)
      .getByRole("option", { name: "Linear", exact: true })
      .click();
    await connection.entered;
    await expect(skeleton(page, "workspace")).toBeVisible();
    await expect(
      app(page).getByText("Connect Linear", { exact: true }),
    ).toHaveCount(0);
    connection.release();
    await scopes.entered;
    await expect(skeleton(page, "workspace")).toBeVisible();
    await expect(
      app(page).getByText("No matching Issues.", { exact: true }),
    ).toHaveCount(0);
    scopes.release();
    await list.entered;
    await expect(skeleton(page, "workspace")).toHaveCount(0);
    await expect(skeleton(page, "list")).toBeVisible();
    await expect(skeleton(page, "detail")).toBeVisible();
    list.release();
    await detail.entered;
    await expect(app(page).locator(".linear-list-row").first()).toBeVisible();
    await expect(skeleton(page, "list")).toHaveCount(0);
    await expect(skeleton(page, "detail")).toBeVisible();
    detail.release();
    await expect(
      app(page).getByRole("heading", { name: linearTitle, exact: true }),
    ).toBeVisible();
    await expect(skeleton(page)).toHaveCount(0);
  } finally {
    Object.values(gates).forEach((pending) => pending.release());
  }
});

test("a Linear scopes error ends loading and retries instead of leaving a permanent skeleton", async ({
  page,
}) => {
  await openGithub(page);
  let fail = true;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "linear_scopes" && fail)
      return route.fulfill({
        json: toolFailure("Fixture team discovery is temporarily unavailable."),
      });
    return route.continue();
  });
  await choose(app(page), "Issue source", "linear");
  const error = app(page).getByRole("alert").filter({
    hasText: "Fixture team discovery is temporarily unavailable.",
  });
  await expect(error).toBeVisible();
  await expect(skeleton(page)).toHaveCount(0);
  await expect(
    app(page).getByText("Connect Linear", { exact: true }),
  ).toHaveCount(0);
  fail = false;
  await error.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    app(page).getByRole("heading", { name: linearTitle, exact: true }),
  ).toBeVisible();
  await expect(error).toHaveCount(0);
});

for (const source of ["github", "linear"] as const) {
  test(`${source} refresh keeps the loaded detail and editable comment draft while requests are pending`, async ({
    page,
  }) => {
    await openGithub(page);
    if (source === "linear") {
      await choose(app(page), "Issue source", "linear");
      await expect(
        app(page).getByRole("heading", { name: linearTitle, exact: true }),
      ).toBeVisible();
    }
    const comment = app(page).getByRole("textbox", {
      name: source === "linear" ? "Linear comment" : "Comment on GitHub",
      exact: true,
    });
    await comment.fill("An unsent draft stays editable during refresh.");
    const detail = gate();
    const detailTool =
      source === "linear" ? "linear_get_issue" : "arco_get_issue";
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      if (input.name === detailTool) await detail.wait();
      await route.continue();
    });
    try {
      await app(page)
        .getByRole("button", {
          name: source === "linear" ? "Refresh Linear" : "Refresh",
          exact: true,
        })
        .click();
      await detail.entered;
      await expect(
        app(page).getByRole("heading", {
          name: source === "linear" ? linearTitle : githubTitle,
          exact: true,
        }),
      ).toBeVisible();
      await expect(skeleton(page)).toHaveCount(0);
      await expect(comment).toHaveValue(
        "An unsent draft stays editable during refresh.",
      );
      await comment.fill(
        "The same draft was edited while refresh was pending.",
      );
      const response = page.waitForResponse(
        (candidate) =>
          candidate.url().endsWith("/tool") &&
          candidate.request().postDataJSON().name === detailTool,
      );
      detail.release();
      await response;
      await expect(comment).toHaveValue(
        "The same draft was edited while refresh was pending.",
      );
      await expect(skeleton(page)).toHaveCount(0);
    } finally {
      detail.release();
    }
  });
}

test("reduced motion keeps the loading skeleton static", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const connection = gate();
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "arco_connection") await connection.wait();
    await route.continue();
  });
  try {
    await page.goto("/");
    await connection.entered;
    const boot = skeleton(page, "workspace");
    await expect(boot).toBeVisible();
    expect(
      await boot.evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      ),
    ).toBe(0);
  } finally {
    connection.release();
  }
  await expect(
    app(page).getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
});

test("animated creation dialogs close with Escape, restore focus, and can reopen during exit", async ({
  page,
}) => {
  await openGithub(page);
  await choose(app(page), "GitHub view", "yu/Arco");
  const trigger = app(page).getByRole("button", {
    name: "Create issue",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = app(page).getByRole("dialog", {
    name: "Create issue",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
