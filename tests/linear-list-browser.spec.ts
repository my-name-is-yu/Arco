import { toolFailure } from "./tool-failure";
import { expect, test, type Page } from "./browser-test";
import type { LinearIssueSummary, LinearPage } from "../src/shared/linear";
import { choose, selectControl } from "./select-helpers";

type ListCall = {
  connectionId: string;
  workspaceId: string;
  teamId: string;
  query: string;
  order: string;
  stateId?: string;
  assigneeId?: string;
  labelId?: string;
  projectId?: string;
  cursor?: string;
};
type ListResult = LinearPage | { error: string };
const app = (page: Page) => page.frameLocator("#arco");
const firstTitle = "Keep Linear workflow states intact";
const issue = (number = 42): LinearIssueSummary => ({
  connectionId: "default",
  workspaceId: "fixture-linear-workspace",
  teamId: "fixture-linear-team",
  source: "linear",
  issueId: `fixture-linear-${number}`,
  identifier: `YU-${number}`,
  title: number === 42 ? firstTitle : `Linear paging issue ${number}`,
  url: `https://linear.app/fixture/issue/YU-${number}`,
  updatedAt: "2026-10-24T00:00:00.000Z",
  state: {
    id: "linear-state-progress",
    name: "In Progress",
    type: "started",
    color: "#f2c94c",
  },
});
const pageNumber = (call: ListCall) =>
  call.cursor ? Number(call.cursor.match(/\d+$/)?.[0]) : 1;
const nextCursor = (number: number) => `linear-opaque-cursor-${number}`;

async function listFixture(
  page: Page,
  result: (call: ListCall) => ListResult | Promise<ListResult>,
) {
  const calls: ListCall[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: ListCall;
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
      // Finish the coalesced launch notification before counting list calls.
      await page.waitForTimeout(150);
      return route.fulfill({ response });
    }
    if (input.name === "linear_scopes") {
      const response = await route.fetch();
      const native = await response.json();
      native.structuredContent.teams.push({
        id: "another-linear-team",
        name: "Another team",
        key: "ALT",
      });
      return route.fulfill({ response, json: native });
    }
    if (
      input.name === "linear_metadata" &&
      input.arguments.teamId === "another-linear-team"
    ) {
      const response = await route.fetch({
        postData: {
          ...input,
          arguments: { ...input.arguments, teamId: "fixture-linear-team" },
        },
      });
      return route.fulfill({ response });
    }
    if (input.name !== "linear_list_issues") return route.continue();
    calls.push(input.arguments);
    const value = await result(input.arguments);
    if ("error" in value)
      return route.fulfill({
        json: toolFailure(value.error),
      });
    return route.fulfill({ json: { content: [], structuredContent: value } });
  });
  return calls;
}

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await choose(app(page), "Issue source", "linear");
  await expect(selectControl(app(page), "Linear Team")).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
}

test(
  "a Linear page without a required cursor reports an error instead of silently ending the list",
  { tag: "@smoke" },
  async ({ page }) => {
    const calls = await listFixture(page, () => ({
      issues: [],
      hasMore: true,
      cursor: null,
    }));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await expect(
      app(page).getByText(
        "Linear returned no continuation cursor. Refresh the list.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(errors).toEqual([]);
  },
);

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

test("a short Linear page continues with its opaque cursor", async ({
  page,
}) => {
  const calls = await listFixture(page, (call) => ({
    issues: pageNumber(call) === 1 ? [issue()] : [issue(43)],
    hasMore: pageNumber(call) === 1,
    cursor: pageNumber(call) === 1 ? nextCursor(2) : null,
  }));
  await open(page);
  await expect(app(page).locator(".issue-row")).toHaveCount(2);
  expect(calls.map((call) => call.cursor)).toEqual([undefined, nextCursor(2)]);
  expect(calls.every((call) => call.teamId === "fixture-linear-team")).toBe(
    true,
  );
  await expect(
    app(page).getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(
    app(page).getByRole("button", { name: "Load more" }),
  ).toBeHidden();
});

test("scrolling beyond 100 Linear summaries preserves selection and scroll", async ({
  page,
}) => {
  const firstPage = [
    issue(),
    ...Array.from({ length: 99 }, (_, index) => issue(100 + index)),
  ];
  const calls = await listFixture(page, (call) => ({
    issues: pageNumber(call) === 1 ? firstPage : [issue(43)],
    hasMore: pageNumber(call) === 1,
    cursor: pageNumber(call) === 1 ? nextCursor(2) : null,
  }));
  await open(page);
  const list = app(page).locator(".issue-list");
  await expect(list.locator(".issue-row")).toHaveCount(100);
  expect(calls.map((call) => call.cursor)).toEqual([undefined]);
  const selected = list.locator(".issue-row.selected");
  await expect(selected).toContainText(firstTitle);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(list.locator(".issue-row")).toHaveCount(101);
  expect(calls.map((call) => call.cursor)).toEqual([undefined, nextCursor(2)]);
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );
  await expect(selected).toContainText(firstTitle);
  await expect(
    app(page).getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
});

test("Linear automatic paging has a budget that resets with team, search, filters and order", async ({
  page,
}) => {
  const calls = await listFixture(page, (call) => ({
    issues: [],
    hasMore: true,
    cursor: nextCursor(pageNumber(call) + 1),
  }));
  await open(page);
  const ui = app(page);
  let previousCalls = 0;
  async function freshScope(expected: Partial<ListCall>) {
    await expect.poll(() => calls.length).toBe(previousCalls + 4);
    await page.waitForTimeout(200);
    const fresh = calls.slice(previousCalls);
    expect(fresh).toHaveLength(4);
    expect(fresh[0]).toMatchObject(expected);
    expect(fresh[0]).not.toHaveProperty("cursor");
    expect(fresh.map((call) => call.cursor)).toEqual([
      undefined,
      nextCursor(2),
      nextCursor(3),
      nextCursor(4),
    ]);
    expect(
      fresh.every((call) =>
        Object.entries(expected).every(
          ([key, value]) => call[key as keyof ListCall] === value,
        ),
      ),
    ).toBe(true);
    previousCalls += 4;
  }
  await freshScope({
    teamId: "fixture-linear-team",
    query: "",
    order: "updatedAt",
  });
  await ui
    .getByRole("textbox", { name: "Search Linear Issues", exact: true })
    .fill("workflow");
  await freshScope({ query: "workflow" });
  await choose(ui, "Linear workflow state", "linear-state-progress");
  await freshScope({ query: "workflow", stateId: "linear-state-progress" });
  await ui.locator(".linear-filters > summary").click();
  await choose(ui, "Assignee", "fixture-linear-user");
  await freshScope({ assigneeId: "fixture-linear-user" });
  await choose(ui, "Labels", "linear-label-design");
  await freshScope({ labelId: "linear-label-design" });
  await choose(ui, "Project", "linear-project");
  await freshScope({ projectId: "linear-project" });
  await choose(ui, "Sort", "createdAt");
  await freshScope({ order: "createdAt" });
  await ui.locator(".linear-filters > summary").click();
  await choose(ui, "Linear Team", "another-linear-team");
  await freshScope({
    teamId: "another-linear-team",
    query: "",
    order: "updatedAt",
  });
  await ui.getByRole("button", { name: "Load more", exact: true }).click();
  await expect.poll(() => calls.length).toBe(previousCalls + 4);
  expect(calls.slice(previousCalls).map((call) => call.cursor)).toEqual([
    nextCursor(5),
    nextCursor(6),
    nextCursor(7),
    nextCursor(8),
  ]);
});

test("a failed Linear continuation waits for Load more and retries its cursor", async ({
  page,
}) => {
  let fail = true;
  const calls = await listFixture(page, (call) => {
    if (call.cursor && fail)
      return { error: "Fixture Linear page unavailable." };
    return {
      issues: pageNumber(call) === 1 ? [issue()] : [issue(43)],
      hasMore: pageNumber(call) === 1,
      cursor: pageNumber(call) === 1 ? nextCursor(2) : null,
    };
  });
  await open(page);
  await expect(app(page).getByRole("alert")).toContainText(
    "Could not load more issues: Fixture Linear page unavailable.",
  );
  await page.waitForTimeout(350);
  expect(calls.map((call) => call.cursor)).toEqual([undefined, nextCursor(2)]);
  fail = false;
  await app(page)
    .getByRole("button", { name: "Load more", exact: true })
    .click();
  await expect(app(page).locator(".issue-row")).toHaveCount(2);
  await expect(app(page).getByRole("alert")).toBeHidden();
  expect(calls.map((call) => call.cursor)).toEqual([
    undefined,
    nextCursor(2),
    nextCursor(2),
  ]);
});

test("compact Linear cards pause continuation until expanded", async ({
  page,
}) => {
  let release!: () => void;
  const firstPage = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await listFixture(page, async (call) => {
    if (!call.cursor) await firstPage;
    return {
      issues: pageNumber(call) === 1 ? [issue()] : [issue(43)],
      hasMore: pageNumber(call) === 1,
      cursor: pageNumber(call) === 1 ? nextCursor(2) : null,
    };
  });
  try {
    await open(page);
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    release();
    await expect(app(page).locator(".inline-mode")).toContainText("YU-42");
    await page.waitForTimeout(350);
    expect(calls.map((call) => call.cursor)).toEqual([undefined]);
    await page
      .getByRole("button", { name: "Mock fullscreen", exact: true })
      .click();
    await expect(app(page).locator(".issue-row")).toHaveCount(2);
    expect(calls.map((call) => call.cursor)).toEqual([
      undefined,
      nextCursor(2),
    ]);
  } finally {
    release();
  }
});

test("a narrow Linear detail pauses hidden continuation until returning to the list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 900 });
  let release!: () => void;
  const secondPage = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await listFixture(page, async (call) => {
    const number = pageNumber(call);
    if (number === 2) await secondPage;
    return {
      issues: number === 1 ? [issue()] : [],
      hasMore: number < 3,
      cursor: number < 3 ? nextCursor(number + 1) : null,
    };
  });
  try {
    await open(page);
    await expect(app(page).locator(".issue-row")).toHaveCount(1);
    await expect.poll(() => calls.length).toBe(2);
    await app(page).locator(".issue-row").click();
    await expect(app(page).locator(".issue-sidebar")).toBeHidden();
    release();
    await page.waitForTimeout(350);
    expect(calls.map((call) => call.cursor)).toEqual([
      undefined,
      nextCursor(2),
    ]);
    await app(page)
      .getByRole("button", { name: "Back to Linear list", exact: true })
      .click();
    await expect(app(page).locator(".issue-sidebar")).toBeVisible();
    await expect.poll(() => calls.length).toBe(3);
    expect(calls.map((call) => call.cursor)).toEqual([
      undefined,
      nextCursor(2),
      nextCursor(3),
    ]);
  } finally {
    release();
  }
});

test("multiple Linear pages skip polling and focus replays while Refresh reloads all opened pages", async ({
  page,
}) => {
  await page.clock.install();
  const calls = await listFixture(page, (call) => ({
    issues: pageNumber(call) === 1 ? [issue()] : [issue(43)],
    hasMore: pageNumber(call) === 1,
    cursor: pageNumber(call) === 1 ? nextCursor(2) : null,
  }));
  await open(page);
  await expect(app(page).locator(".issue-row")).toHaveCount(2);
  expect(calls).toHaveLength(2);
  await page.clock.fastForward(31_000);
  await restoreFocus(page);
  await page.waitForTimeout(200);
  expect(calls).toHaveLength(2);
  await app(page)
    .getByRole("button", { name: "Refresh Linear", exact: true })
    .click();
  await expect.poll(() => calls.length).toBe(4);
  expect(calls.map((call) => call.cursor)).toEqual([
    undefined,
    nextCursor(2),
    undefined,
    nextCursor(2),
  ]);
});

test("a single Linear page still refreshes automatically and on focus", async ({
  page,
}) => {
  await page.clock.install();
  const calls = await listFixture(page, () => ({
    issues: [issue()],
    hasMore: false,
    cursor: null,
  }));
  await open(page);
  await expect(app(page).locator(".issue-row")).toHaveCount(1);
  expect(calls).toHaveLength(1);
  await page.clock.fastForward(31_000);
  await expect.poll(() => calls.length).toBe(2);
  await page.clock.fastForward(16_000);
  await restoreFocus(page);
  await expect.poll(() => calls.length).toBe(3);
});
