import { toolFailure } from "./tool-failure";
import { expect, test, type Page } from "./browser-test";
import type { IssueSummary } from "../src/shared/contracts";
import { choose, selectControl } from "./select-helpers";

type ListCall = { page: number; filter: string; state: string };
type ListResult =
  { issues: IssueSummary[]; hasMore: boolean } | { error: string };
const app = (page: Page) => page.frameLocator("#arco");
const firstTitle = "Preserve issue selection and scroll position";
const issue = (number = 42): IssueSummary => ({
  repo: "yu/Arco",
  number,
  source: "github",
  id: `paging-issue-${number}`,
  title: number === 42 ? firstTitle : `Paging issue ${number}`,
  state: "open",
  updatedAt: "2026-10-24T00:00:00Z",
  url: `https://github.com/yu/Arco/issues/${number}`,
  author: "fixture-author",
  labels: [],
  assignees: [],
});

async function listFixture(
  page: Page,
  result: (call: ListCall) => ListResult | Promise<ListResult>,
) {
  const calls: ListCall[] = [];
  let fixtureMode = false;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: Partial<ListCall>;
    };
    if (input.name === "arco_connection") {
      const response = await route.fetch();
      const native = (await response.json()) as {
        structuredContent: { mode: string };
      };
      expect(native.structuredContent.mode).toBe("fixture");
      await expect
        .poll(async () => {
          const events = JSON.parse(
            (await page.locator("#events").textContent()) ?? "[]",
          ) as { type: string }[];
          return events.some((event) => event.type === "launch");
        })
        .toBe(true);
      // The launch result triggers a coalesced data notification after 100ms.
      // Finish startup before measuring user-driven pagination requests.
      await page.waitForTimeout(150);
      fixtureMode = true;
      return route.fulfill({ response });
    }
    if (input.name !== "arco_account_issues") return route.continue();
    expect(fixtureMode).toBe(true);
    const call = {
      page: input.arguments.page ?? 1,
      filter: input.arguments.filter ?? "assigned",
      state: input.arguments.state ?? "open",
    };
    calls.push(call);
    const value = await result(call);
    if ("error" in value)
      return route.fulfill({
        json: toolFailure(value.error),
      });
    return route.fulfill({
      json: {
        content: [{ type: "text", text: "Fixture issue summaries loaded." }],
        structuredContent: {
          scope: "account",
          filter: call.filter,
          page: call.page,
          ...value,
        },
      },
    });
  });
  return calls;
}

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await expect(selectControl(app(page), "GitHub view")).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
}

test("a PR-only first page continues automatically in the same account scope", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      document.documentElement.dataset.accountCspViolations = JSON.stringify([
        ...JSON.parse(
          document.documentElement.dataset.accountCspViolations ?? "[]",
        ),
        event.effectiveDirective,
      ]);
    });
  });
  const calls = await listFixture(page, ({ page: number }) => ({
    issues: number === 1 ? [] : [issue()],
    hasMore: number === 1,
  }));
  await open(page);
  await expect(app(page).locator(".issue-row")).toHaveCount(1);
  await expect(
    app(page).getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(
    app(page).getByRole("button", {
      name: "View issues created by me",
      exact: true,
    }),
  ).toBeHidden();
  await expect(app(page).locator(".issue-kicker")).toContainText("yu/Arco #42");
  expect(calls.map((call) => call.page)).toEqual([1, 2]);
  expect(calls.every((call) => call.filter === "assigned")).toBe(true);
  await expect(
    app(page).getByRole("button", { name: "Load more" }),
  ).toBeHidden();
  const violations = await Promise.all(
    page
      .frames()
      .map((frame) =>
        frame.evaluate(() =>
          JSON.parse(
            document.documentElement.dataset.accountCspViolations ?? "[]",
          ),
        ),
      ),
  );
  expect(violations.flat()).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test("scrolling the list continues past a PR-heavy page and keeps selection and scroll", async ({
  page,
}) => {
  const firstPage = [
    issue(),
    ...Array.from({ length: 19 }, (_, index) => issue(100 + index)),
  ];
  const calls = await listFixture(page, ({ page: number }) => ({
    issues: number === 1 ? firstPage : [issue(200)],
    hasMore: number === 1,
  }));
  await open(page);
  const list = app(page).locator(".issue-list");
  await expect(list.locator(".issue-row")).toHaveCount(20);
  expect(calls.map((call) => call.page)).toEqual([1]);
  await expect(app(page).locator(".list-caption")).toContainText(
    "20 issues loaded",
  );
  const selected = list.locator('.issue-row[aria-current="true"]');
  await expect(selected).toContainText(firstTitle);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(list.locator(".issue-row")).toHaveCount(21);
  expect(calls.map((call) => call.page)).toEqual([1, 2]);
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );
  await expect(selected).toContainText(firstTitle);
  await expect(
    app(page).getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
});

test("next-page errors stop automatic retries and Load more retries that page", async ({
  page,
}) => {
  let fail = true;
  const calls = await listFixture(page, ({ page: number }) => {
    if (number === 2 && fail)
      return { error: "Fixture next page unavailable." };
    return { issues: number === 1 ? [] : [issue()], hasMore: number === 1 };
  });
  await open(page);
  await expect(app(page).getByRole("alert")).toContainText(
    "Could not load more issues: Fixture next page unavailable.",
  );
  await page.waitForTimeout(350);
  expect(calls.map((call) => call.page)).toEqual([1, 2]);
  fail = false;
  await app(page)
    .getByRole("button", { name: "Load more", exact: true })
    .click();
  await expect(app(page).locator(".issue-row")).toHaveCount(1);
  await expect(app(page).getByRole("alert")).toBeHidden();
  expect(calls.map((call) => call.page)).toEqual([1, 2, 2]);
});

test("automatic continuation has a page budget and resets for a new scope", async ({
  page,
}) => {
  const calls = await listFixture(page, () => ({ issues: [], hasMore: true }));
  await open(page);
  await expect.poll(() => calls.length).toBe(4);
  await page.waitForTimeout(350);
  expect(calls.map((call) => call.page)).toEqual([1, 2, 3, 4]);
  await expect(
    app(page).getByRole("button", { name: "Load more" }),
  ).toBeEnabled();
  await choose(app(page), "GitHub view", "account:mentioned");
  await expect.poll(() => calls.length).toBe(8);
  await page.waitForTimeout(350);
  expect(
    calls
      .filter((call) => call.filter === "mentioned")
      .map((call) => call.page),
  ).toEqual([1, 2, 3, 4]);
  await app(page)
    .getByRole("button", { name: "Load more", exact: true })
    .click();
  await expect.poll(() => calls.length).toBe(12);
  await page.waitForTimeout(350);
  expect(calls.slice(8).map((call) => call.page)).toEqual([5, 6, 7, 8]);
});

test("the compact card keeps hidden account pagination quiet until expanded", async ({
  page,
}) => {
  let release!: () => void;
  const firstPage = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await listFixture(page, async ({ page: number }) => {
    if (number === 1) await firstPage;
    return { issues: number === 1 ? [] : [issue()], hasMore: number === 1 };
  });
  try {
    await open(page);
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    await expect(
      app(page).locator('[data-loading-skeleton="inline"]'),
    ).toBeVisible();
    release();
    await expect(
      app(page).getByRole("heading", {
        name: "No issues on this page",
        exact: true,
      }),
    ).toBeVisible();
    await page.waitForTimeout(350);
    expect(calls.map((call) => call.page)).toEqual([1]);
    await page
      .getByRole("button", { name: "Mock fullscreen", exact: true })
      .click();
    await expect(app(page).locator(".issue-row")).toHaveCount(1);
    expect(calls.map((call) => call.page)).toEqual([1, 2]);
  } finally {
    release();
  }
});

test("a mobile detail view pauses hidden pagination until returning to the list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 900 });
  let release!: () => void;
  const secondPage = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await listFixture(page, async ({ page: number }) => {
    if (number === 2) await secondPage;
    return { issues: number === 1 ? [issue()] : [], hasMore: number < 3 };
  });
  try {
    await open(page);
    await expect(app(page).locator(".issue-row")).toHaveCount(1);
    await expect.poll(() => calls.length).toBe(2);
    await app(page).locator(".issue-row").click();
    await expect(app(page).locator(".issue-sidebar")).toBeHidden();
    release();
    await expect.poll(() => calls.length).toBe(2);
    await page.waitForTimeout(350);
    expect(calls.map((call) => call.page)).toEqual([1, 2]);
    await app(page)
      .getByRole("button", { name: "Back to list", exact: true })
      .click();
    await expect(app(page).locator(".issue-sidebar")).toBeVisible();
    await expect.poll(() => calls.length).toBe(3);
    expect(calls.map((call) => call.page)).toEqual([1, 2, 3]);
  } finally {
    release();
  }
});
