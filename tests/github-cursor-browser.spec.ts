import { expect, test, type Page } from "./browser-test";
import type { IssueSummary } from "../src/shared/contracts";
import { choose, selectControl } from "./select-helpers";

type ListCall = {
  name: "arco_list_issues" | "arco_account_issues";
  arguments: {
    repo?: string;
    filter?: string;
    query?: string;
    state: string;
    sort: string;
    order: string;
    page: number;
    cursor?: string;
  };
};
const nextCursor = "Y3Vyc29yOnYyOpK5MjAyNi0xMC0yNFQwMDowMDowMFo=";
const app = (page: Page) => page.frameLocator("#arco");
const issue = (repo: string, number: number): IssueSummary => ({
  repo,
  number,
  source: "github",
  id: `cursor-issue-${repo}-${number}`,
  title: `Cursor issue ${number}`,
  state: "open",
  updatedAt: "2026-10-24T00:00:00Z",
  url: `https://github.com/${repo}/issues/${number}`,
  author: "fixture-author",
  labels: [],
  assignees: [],
});

async function cursorFixture(page: Page) {
  const calls: ListCall[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: ListCall["arguments"] & { number?: number };
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
      // Let the launch data notification settle before measuring pagination.
      await page.waitForTimeout(150);
      return route.fulfill({ response });
    }
    if (input.name === "arco_repositories") {
      return route.fulfill({
        json: {
          content: [],
          structuredContent: {
            repositories: ["yu/Arco", "yu/Other"].map((repo) => ({
              id: repo,
              repo,
              url: `https://github.com/${repo}`,
              private: false,
              archived: false,
              issuesEnabled: true,
            })),
            page: 1,
            hasMore: false,
          },
        },
      });
    }
    if (input.name === "arco_get_issue") {
      return route.fulfill({
        json: {
          content: [],
          structuredContent: {
            ...issue(input.arguments.repo!, input.arguments.number!),
            body: "Cursor pagination fixture detail.",
            stateReason: null,
            comments: [],
            commentsHasMore: false,
            projects: [],
          },
        },
      });
    }
    if (input.name === "arco_repo_metadata")
      return route.fulfill({
        json: {
          content: [],
          structuredContent: { labels: [], assignees: [] },
        },
      });
    if (
      input.name !== "arco_list_issues" &&
      input.name !== "arco_account_issues"
    )
      return route.continue();
    calls.push({ name: input.name, arguments: input.arguments });
    const first = input.arguments.page === 1;
    const repository = input.name === "arco_list_issues";
    return route.fulfill({
      json: {
        content: [],
        structuredContent: {
          issues: (first ? [42, 43, 41] : [44]).map((number) =>
            issue(input.arguments.repo ?? "yu/Arco", number),
          ),
          page: input.arguments.page,
          hasMore: first,
          ...(repository
            ? first
              ? { nextCursor }
              : {}
            : { scope: "account", filter: input.arguments.filter }),
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

test(
  "repository pages without a required cursor show an error and do not fall back to page-only requests",
  { tag: "@smoke" },
  async ({ page }) => {
    await cursorFixture(page);
    const errors: string[] = [];
    const pages: number[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: ListCall["arguments"];
      };
      if (input.name !== "arco_list_issues") return route.fallback();
      pages.push(input.arguments.page);
      return route.fulfill({
        json: {
          content: [],
          structuredContent: { issues: [], page: 1, hasMore: true },
        },
      });
    });
    await open(page);
    await choose(app(page), "GitHub view", "yu/Arco");
    await expect(
      app(page).getByRole("alert").filter({
        hasText: "GitHub returned no continuation cursor. Refresh the list.",
      }),
    ).toBeVisible();
    expect(pages).toEqual([1]);
    expect(errors).toEqual([]);
  },
);

test("repository continuation forwards the opaque cursor and keeps numeric pages", async ({
  page,
}) => {
  const calls = await cursorFixture(page);
  await open(page);
  await choose(app(page), "GitHub view", "yu/Arco");
  await expect(app(page).locator(".issue-row")).toHaveCount(4);
  expect(calls.filter((call) => call.name === "arco_list_issues")).toEqual([
    {
      name: "arco_list_issues",
      arguments: {
        repo: "yu/Arco",
        query: "",
        state: "open",
        sort: "updated",
        order: "desc",
        page: 1,
      },
    },
    {
      name: "arco_list_issues",
      arguments: {
        repo: "yu/Arco",
        query: "",
        state: "open",
        sort: "updated",
        order: "desc",
        page: 2,
        cursor: nextCursor,
      },
    },
  ]);
});

test("repository, search, state and ordering changes start with no old cursor", async ({
  page,
}) => {
  const calls = await cursorFixture(page);
  await open(page);
  const ui = app(page);
  let previousCalls = 0;
  async function expectFreshScope(expected: Partial<ListCall["arguments"]>) {
    await expect
      .poll(
        () => calls.filter((call) => call.name === "arco_list_issues").length,
      )
      .toBe(previousCalls + 2);
    const fresh = calls
      .filter((call) => call.name === "arco_list_issues")
      .slice(previousCalls);
    expect(fresh[0].arguments).toMatchObject({ ...expected, page: 1 });
    expect(fresh[0].arguments).not.toHaveProperty("cursor");
    expect(fresh[1].arguments).toMatchObject({
      ...expected,
      page: 2,
      cursor: nextCursor,
    });
    previousCalls += 2;
  }
  await choose(ui, "GitHub view", "yu/Arco");
  await expectFreshScope({ repo: "yu/Arco", query: "", state: "open" });
  await ui
    .getByRole("textbox", { name: "Search issues", exact: true })
    .fill("cursor");
  await expectFreshScope({ repo: "yu/Arco", query: "cursor" });
  await ui.getByRole("button", { name: "All", exact: true }).click();
  await expectFreshScope({ query: "cursor", state: "all" });
  await ui.locator(".sidebar-filters > summary").click();
  await choose(ui, "Sort issues", "comments");
  await expectFreshScope({ query: "cursor", state: "all", sort: "comments" });
  await choose(ui, "Sort direction", "asc");
  await expectFreshScope({
    query: "cursor",
    state: "all",
    sort: "comments",
    order: "asc",
  });
  await choose(ui, "GitHub view", "yu/Other");
  await expectFreshScope({
    repo: "yu/Other",
    query: "",
    state: "open",
    sort: "updated",
    order: "desc",
  });
});

test("personal feeds continue with numeric pages and no repository cursor", async ({
  page,
}) => {
  const calls = await cursorFixture(page);
  await open(page);
  await expect(app(page).locator(".issue-row")).toHaveCount(4);
  await choose(app(page), "GitHub view", "account:mentioned");
  await expect
    .poll(
      () => calls.filter((call) => call.name === "arco_account_issues").length,
    )
    .toBe(4);
  const personal = calls.filter((call) => call.name === "arco_account_issues");
  expect(
    personal.map((call) => [call.arguments.filter, call.arguments.page]),
  ).toEqual([
    ["assigned", 1],
    ["assigned", 2],
    ["mentioned", 1],
    ["mentioned", 2],
  ]);
  for (const call of personal) {
    expect(call.arguments).not.toHaveProperty("cursor");
    expect(call.arguments).not.toHaveProperty("repo");
  }
});
