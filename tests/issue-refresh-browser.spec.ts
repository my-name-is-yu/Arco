import { expect, test, type Page } from "./browser-test";
import { toolFailure } from "./tool-failure";

type Source = "github" | "linear";
type Read = "list" | "detail";
type ToolInput = {
  name: string;
  arguments: { number?: number; issueId?: string };
};
const app = (page: Page) => page.frameLocator("#arco");
const titles = {
  github: "Separate shared context from sending a request",
  linear: "Share a Linear issue with the Codex chat",
};
function browsingRead(source: Source, input: ToolInput): Read | null {
  if (
    input.name ===
    (source === "github" ? "arco_list_issues" : "linear_list_issues")
  )
    return "list";
  if (
    input.name ===
      (source === "github" ? "arco_get_issue" : "linear_get_issue") &&
    (source === "github"
      ? input.arguments.number === 43
      : input.arguments.issueId === "fixture-linear-43")
  )
    return "detail";
  return null;
}
async function open(page: Page, source: Source) {
  await page.goto(`/?source=${source}&shared=${source}&sharedRepo=yu/Arco`);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await app(page)
    .locator(".issue-row")
    .filter({ hasText: titles[source] })
    .click();
  await expect(
    app(page).getByRole("heading", { name: titles[source], exact: true }),
  ).toBeVisible();
  // Keep the launch's coalesced data notification out of measured reads.
  await page.waitForTimeout(150);
}
async function mode(page: Page, value: "inline" | "fullscreen") {
  await page
    .getByRole("button", { name: `Mock ${value}`, exact: true })
    .click();
  await expect(
    app(page).locator(value === "inline" ? ".inline-issue-card" : ".workspace"),
  ).toBeVisible();
}
function gate() {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
}
async function restoreFocus(page: Page) {
  await app(page)
    .locator("html")
    .evaluate(() => {
      for (const value of ["hidden", "visible"]) {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value,
        });
        window.dispatchEvent(new Event("visibilitychange"));
      }
    });
}

for (const source of ["github", "linear"] as const) {
  test(`${source} repeated returns reuse pending browsing list and detail reads`, async ({
    page,
  }) => {
    await page.clock.install();
    await open(page, source);
    await mode(page, "inline");
    await page.clock.fastForward(16_000);
    const waiting = { list: gate(), detail: gate() };
    const reads: Read[] = [];
    const title = `Fresh ${source} browsing issue`;
    await page.route("**/tool", async (route) => {
      const read = browsingRead(source, route.request().postDataJSON());
      if (!read) return route.continue();
      reads.push(read);
      const response = await route.fetch();
      const result = await response.json();
      if (read === "detail") result.structuredContent.title = title;
      else
        for (const issue of result.structuredContent.issues)
          if (issue.number === 43 || issue.issueId === "fixture-linear-43")
            issue.title = title;
      await waiting[read].pending;
      return route.fulfill({ response, json: result });
    });
    try {
      await mode(page, "fullscreen");
      // The transport queue runs one background read at a time. Exercise
      // repeated visibility changes first with the list, then the detail held.
      await expect.poll(() => reads).toEqual(["list"]);
      await mode(page, "inline");
      await mode(page, "fullscreen");
      await page.waitForTimeout(200);
      expect(reads).toEqual(["list"]);
      waiting.list.release();
      await expect.poll(() => reads).toEqual(["list", "detail"]);
      await mode(page, "inline");
      await mode(page, "fullscreen");
      await page.waitForTimeout(200);
      expect(reads).toEqual(["list", "detail"]);
      waiting.detail.release();
      await expect(
        app(page).getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      await expect(
        app(page).locator(".issue-row").filter({ hasText: title }),
      ).toHaveCount(1);
      await expect(app(page).locator(".issue-list")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      expect([...reads].sort()).toEqual(["detail", "list"]);
      await expect(page.locator("#harness-error")).toBeEmpty();
    } finally {
      waiting.list.release();
      waiting.detail.release();
    }
  });

  test(`${source} failed lists wait for explicit retry while visible details recover automatically`, async ({
    page,
  }) => {
    await page.clock.install();
    await open(page, source);
    let fail = true;
    const reads: Read[] = [];
    await page.route("**/tool", async (route) => {
      const read = browsingRead(source, route.request().postDataJSON());
      if (!read) return route.continue();
      reads.push(read);
      if (fail)
        return route.fulfill({
          json: toolFailure(`Fixture ${read} unavailable`),
        });
      return route.continue();
    });
    const refresh = app(page).getByRole("button", {
      name: source === "github" ? "Refresh" : "Refresh Linear",
      exact: true,
    });
    await refresh.click();
    await expect(
      app(page)
        .getByRole("alert")
        .filter({ hasText: "Fixture list unavailable" }),
    ).toBeVisible();
    await expect(
      app(page)
        .getByRole("alert")
        .filter({ hasText: "Could not refresh this issue." }),
    ).toContainText("Fixture detail unavailable");
    expect([...reads].sort()).toEqual(["detail", "list"]);
    fail = false;
    await mode(page, "inline");
    await page.clock.fastForward(31_000);
    await mode(page, "fullscreen");
    await expect
      .poll(() => reads.filter((read) => read === "detail").length)
      .toBe(2);
    await expect(
      app(page)
        .getByRole("alert")
        .filter({ hasText: "Could not refresh this issue." }),
    ).toHaveCount(0);
    await page.clock.fastForward(31_000);
    await restoreFocus(page);
    await mode(page, "inline");
    await page.clock.fastForward(16_000);
    await mode(page, "fullscreen");
    await page.waitForTimeout(200);
    expect(reads.filter((read) => read === "list")).toHaveLength(1);
    await expect(
      app(page)
        .getByRole("alert")
        .filter({ hasText: "Fixture list unavailable" }),
    ).toBeVisible();
    await refresh.click();
    await expect
      .poll(() => reads.filter((read) => read === "list").length)
      .toBe(2);
    await expect(
      app(page)
        .getByRole("alert")
        .filter({ hasText: "Fixture list unavailable" }),
    ).toHaveCount(0);
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}
