import { expect, test, type Page } from "@playwright/test";
import { choose, selectControl } from "./select-helpers";

const assignedTitle = "Preserve issue selection and scroll position";
const mentionedTitle = "Separate shared context from sending a request";
const browserErrors = new WeakMap<Page, string[]>();
const app = (page: Page) => page.frameLocator("#arco");
async function accountCalls(page: Page) {
  const events: {
    type: string;
    value: { name?: string; arguments?: Record<string, unknown> };
  }[] = JSON.parse((await page.locator("#events").textContent()) ?? "[]");
  return events
    .filter(
      (event) =>
        event.type === "tool" && event.value.name === "arco_account_issues",
    )
    .map((event) => event.value.arguments!);
}
async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await expect(selectControl(app(page), "GitHub scope")).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
}

test.beforeEach(async ({ page }) => {
  browserErrors.set(page, []);
  page.on("pageerror", (error) => browserErrors.get(page)!.push(error.message));
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
});

test.afterEach(async ({ page }) => {
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
  expect(browserErrors.get(page)).toEqual([]);
});

test("personal issues load without a repository, and broader scopes stay explicit", async ({
  page,
}) => {
  await open(page);
  const frame = app(page);
  const sidebar = frame.locator(".issue-sidebar");
  const scope = selectControl(frame, "GitHub scope");
  await expect(scope).toHaveAttribute("data-value", "account:assigned");
  await scope.getByRole("button").click();
  await expect(
    frame.getByRole("dialog").getByRole("option", {
      name: "All account repositories",
      exact: true,
    }),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(sidebar.locator(".issue-row")).toHaveCount(1);
  await expect(sidebar.locator(".row-meta")).toContainText("yu/Arco #42");
  await expect(
    frame.getByRole("heading", { name: assignedTitle, exact: true }),
  ).toBeVisible();
  await expect(
    frame.getByRole("textbox", { name: "Search issues", exact: true }),
  ).toBeEnabled();
  await expect(
    frame.getByRole("textbox", { name: "Repository or URL" }),
  ).toBeHidden();
  expect(
    (await accountCalls(page)).every((call) => call.filter === "assigned"),
  ).toBe(true);

  await choose(frame, "GitHub scope", "account:mentioned");
  await expect(sidebar.locator(".issue-row")).toHaveCount(1);
  await expect(sidebar.locator(".issue-row")).toContainText(mentionedTitle);
  await expect(sidebar.locator(".row-meta")).toContainText("yu/Arco #43");

  await choose(frame, "GitHub scope", "account:created");
  await expect(sidebar.locator(".issue-row")).toHaveCount(1);
  await expect(sidebar.locator(".issue-row")).toContainText(assignedTitle);

  await choose(frame, "GitHub scope", "account:all");
  await expect(sidebar.locator(".issue-row")).toHaveCount(2);
  await frame.getByRole("button", { name: "All", exact: true }).click();
  await expect(sidebar.locator(".issue-row")).toHaveCount(3);
  await sidebar
    .getByRole("checkbox", { name: "Select yu/Arco #43 for bulk actions" })
    .check();
  await expect(
    sidebar.getByRole("checkbox", {
      name: "Select yu/Arco #43 for bulk actions",
    }),
  ).toBeChecked();
});

test("discovered repositories enable search without typing a URL", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_connection") return route.continue();
    const response = await route.fetch();
    const result = (await response.json()) as {
      structuredContent: { mode: string; defaultRepo: string | null };
    };
    expect(result.structuredContent.mode).toBe("fixture");
    return route.fulfill({
      response,
      json: {
        ...result,
        structuredContent: { ...result.structuredContent, defaultRepo: null },
      },
    });
  });
  await open(page);
  const frame = app(page);
  const scope = selectControl(frame, "GitHub scope");
  await scope.getByRole("button").click();
  await expect(
    frame
      .getByRole("dialog")
      .getByRole("option", { name: "yu/Arco", exact: true }),
  ).toHaveCount(1);
  await choose(frame, "GitHub scope", "yu/Arco");
  const search = frame.getByRole("textbox", {
    name: "Search issues",
    exact: true,
  });
  await expect(search).toBeEnabled();
  await search.fill("Separate shared context");
  await expect(frame.locator(".issue-sidebar .issue-row")).toHaveCount(1);
  await expect(frame.locator(".issue-sidebar .issue-row")).toContainText(
    mentionedTitle,
  );
  await expect(frame.locator(".repo-tabs")).toHaveCount(0);
  await expect(frame.locator(".sidebar-footer")).not.toContainText("Switch to");
  await choose(frame, "Issue source", "linear");
  await expect(selectControl(frame, "Linear Team")).toHaveAttribute(
    "data-value",
    "fixture-linear-team",
  );
  await expect(frame.locator(".linear-list-row").first()).toBeVisible();
  await expect(
    selectControl(frame.locator(".issue-sidebar"), "Linear workflow state"),
  ).toBeVisible();
  await expect(frame.locator(".sidebar-footer")).not.toContainText("Switch to");
});

test("Scope searches grouped options, skips disabled repositories, and preserves filters on reselect", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_repositories") return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    for (let index = 0; index < 17; index++)
      result.structuredContent.repositories.push({
        id: `fixture-discovered-${index}`,
        repo: `yu/${index === 0 ? "disabled-repo" : `repository-${index}`}`,
        url: `https://github.com/yu/repository-${index}`,
        private: false,
        archived: false,
        issuesEnabled: index !== 0,
      });
    await route.fulfill({ response, json: result });
  });
  await open(page);
  const ui = app(page);
  const scope = selectControl(ui, "GitHub scope");
  const trigger = scope.getByRole("button");
  await expect(trigger).toHaveAccessibleName("Assigned to me");
  await trigger.focus();
  await page.keyboard.press("Space");
  const menu = ui.getByRole("dialog");
  await expect(menu.getByText("Account views", { exact: true })).toBeVisible();
  await expect(menu.getByText("Repositories", { exact: true })).toBeVisible();
  const searchOptions = menu.getByRole("combobox");
  await searchOptions.fill("disabled-repo");
  await expect(
    menu.getByRole("option", {
      name: "yu/disabled-repo (issues disabled)",
      exact: true,
    }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(scope).toHaveAttribute("data-value", "account:assigned");
  await expect(menu).toBeVisible();
  await searchOptions.fill("yu/Arco");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(scope).toHaveAttribute("data-value", "yu/Arco");
  await expect(trigger).toBeFocused();
  const search = ui.getByRole("textbox", {
    name: "Search issues",
    exact: true,
  });
  await search.fill("Separate shared context");
  await expect(ui.locator(".issue-row")).toHaveCount(1);
  await choose(ui, "GitHub scope", "yu/Arco");
  await expect(search).toHaveValue("Separate shared context");
  await expect(ui.locator(".issue-row")).toContainText(mentionedTitle);
  await expect(ui.locator("select")).toHaveCount(0);
});

test("a constrained host handles startup and presentation bursts without overflowing or missing source updates", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.continue();
  });
  const log = async () =>
    JSON.parse((await page.locator("#events").textContent()) ?? "[]") as {
      type: string;
      value: { active?: number; name?: string };
    }[];
  const active = async () =>
    (await log()).findLast((event) => event.type === "tool-pressure")?.value
      .active ?? 0;
  const reads = async () =>
    (await log()).filter(
      (event) => event.type === "tool" && event.value.name === "arco_get_issue",
    ).length;
  await page.goto("/?toolLimit=2");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  const ui = app(page);
  await expect(
    ui.getByRole("heading", { name: assignedTitle, exact: true }),
  ).toBeVisible();
  await expect.poll(active).toBe(0);
  const before = (await log()).filter((event) => event.type === "tool").length;
  await page.getByText("Mock host events", { exact: true }).click();
  await page.getByRole("button", { name: "Mock presentation updates" }).click();
  await page.getByText("Mock host events", { exact: true }).click();
  // Observe beyond the data-notification coalescing window: layout/theme must stay quiet.
  await page.waitForTimeout(350);
  expect((await log()).filter((event) => event.type === "tool")).toHaveLength(
    before,
  );
  const issueReads = await reads();
  await page
    .getByRole("button", { name: "Mock external update #42", exact: true })
    .click();
  await expect(
    ui.getByRole("heading", {
      name: "Issue updated by a Codex tool",
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(active).toBe(0);
  expect(await reads()).toBe(issueReads + 1);
  const recorded = await log();
  expect(recorded.filter((event) => event.type === "tool-rejected")).toEqual(
    [],
  );
  expect(
    Math.max(
      ...recorded
        .filter((event) => event.type === "tool-pressure")
        .map((event) => event.value.active ?? 0),
    ),
  ).toBeLessThanOrEqual(2);
  await expect(ui.getByText(/request queue is full/)).toHaveCount(0);
});

test("compact personal feed resolves loading to empty without broadening scope", async ({
  page,
}) => {
  let release!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { filter?: string };
    };
    if (
      input.name !== "arco_account_issues" ||
      input.arguments.filter !== "assigned"
    )
      return route.continue();
    await responseReady;
    return route.fulfill({
      json: {
        content: [{ type: "text", text: "No assigned issues." }],
        structuredContent: {
          scope: "account",
          filter: "assigned",
          issues: [],
          page: 1,
          hasMore: false,
        },
      },
    });
  });
  try {
    await open(page);
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    await expect(app(page).getByRole("status")).toContainText("Loading issue");
    release();
    await expect(
      app(page).getByRole("heading", {
        name: "No matching issues",
        exact: true,
      }),
    ).toBeVisible();
    await expect(app(page).locator(".compact-summary")).toContainText(
      "Assigned to me",
    );
    expect(
      (await accountCalls(page)).every((call) => call.filter === "assigned"),
    ).toBe(true);
    await app(page)
      .getByRole("button", { name: "View issues created by me", exact: true })
      .click();
    await expect(
      app(page).getByRole("heading", { name: assignedTitle, exact: true }),
    ).toBeVisible();
    expect(
      (await accountCalls(page)).some((call) => call.filter === "created"),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Mock fullscreen", exact: true })
      .click();
    const scope = selectControl(app(page), "GitHub scope");
    await choose(app(page), "GitHub scope", "account:assigned");
    await expect(
      app(page).getByRole("button", {
        name: "View issues created by me",
        exact: true,
      }),
    ).toBeVisible();
    await app(page)
      .getByRole("button", { name: "Choose a repository", exact: true })
      .click();
    await expect(scope.getByRole("button")).toBeFocused();
  } finally {
    release();
  }
});

test("personal feed failures stay visible in compact mode and retry the same scope", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/tool", (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_account_issues" || !fail) return route.continue();
    return route.fulfill({
      json: {
        isError: true,
        content: [{ type: "text", text: "Personal issue feed unavailable." }],
      },
    });
  });
  await open(page);
  await expect(app(page).getByRole("alert")).toContainText(
    "Personal issue feed unavailable.",
  );
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(app(page).getByRole("alert")).toContainText(
    "Personal issue feed unavailable.",
  );
  await page
    .getByRole("button", { name: "Mock fullscreen", exact: true })
    .click();
  const retry = app(page).getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  fail = false;
  await retry.click();
  await expect(
    app(page).getByRole("heading", { name: assignedTitle, exact: true }),
  ).toBeVisible();
  await expect(selectControl(app(page), "GitHub scope")).toHaveAttribute(
    "data-value",
    "account:assigned",
  );
});

test("a PR-only first page loads the next assigned page without broadening scope", async ({
  page,
}) => {
  let fixtureMode = false;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      session: string;
      name: string;
      arguments: { page?: number; filter?: string };
    };
    if (input.name === "arco_connection") {
      const response = await route.fetch();
      const result = (await response.json()) as {
        structuredContent: { mode: string };
      };
      expect(result.structuredContent.mode).toBe("fixture");
      fixtureMode = true;
      return route.fulfill({ response });
    }
    if (input.name !== "arco_account_issues") return route.continue();
    expect(fixtureMode).toBe(true);
    expect(input.arguments.filter).toBe("assigned");
    const pageNumber = input.arguments.page ?? 1;
    const response = await route.fetch({
      postData: JSON.stringify({
        ...input,
        arguments: { ...input.arguments, page: 1 },
      }),
    });
    const result = (await response.json()) as {
      structuredContent: {
        scope: string;
        filter: string;
        issues: unknown[];
        hasMore: boolean;
        page: number;
      };
    };
    expect(result.structuredContent).toMatchObject({
      scope: "account",
      filter: "assigned",
    });
    expect(result.structuredContent.issues.length).toBeGreaterThan(0);
    return route.fulfill({
      response,
      json: {
        ...result,
        content: [
          {
            type: "text",
            text:
              pageNumber === 1
                ? "No issues on this fixture page."
                : "Assigned fixture issue loaded.",
          },
        ],
        structuredContent: {
          ...result.structuredContent,
          issues: pageNumber === 1 ? [] : result.structuredContent.issues,
          hasMore: pageNumber === 1,
          page: pageNumber,
        },
      },
    });
  });
  await open(page);
  const frame = app(page);
  await expect(frame.locator(".issue-list")).toContainText(
    "No issues on this page",
  );
  await expect(
    frame.getByRole("button", {
      name: "View issues created by me",
      exact: true,
    }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(
    frame.getByRole("heading", { name: "No issues on this page", exact: true }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(
    frame.getByRole("heading", { name: assignedTitle, exact: true }),
  ).toBeVisible();
  await expect(frame.locator(".issue-kicker")).toContainText("yu/Arco #42");
  const calls = await accountCalls(page);
  expect(calls.some((call) => call.page === 2)).toBe(true);
  expect(calls.every((call) => call.filter === "assigned")).toBe(true);
});
