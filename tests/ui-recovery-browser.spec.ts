import { expect, test, type Page } from "./browser-test";
import { choose } from "./select-helpers";
import { toolFailure } from "./tool-failure";

const app = (page: Page) => page.frameLocator("#arco");
const firstTitle = "Preserve issue selection and scroll position";
const secondTitle = "Separate shared context from sending a request";
async function open(page: Page) {
  await page.goto("/?entry=project");
  await expect(
    app(page).getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
}
async function fields(page: Page) {
  const ui = app(page);
  const more = ui.locator(".property-advanced");
  if ((await more.getAttribute("open")) === null)
    await more.getByText("More properties", { exact: true }).click();
  const advanced = ui
    .locator("details.advanced-section")
    .filter({ hasText: /^Edit attributes and membership/ });
  if ((await advanced.getAttribute("open")) === null)
    await advanced
      .getByText("Edit attributes and membership", { exact: true })
      .click();
  return ui.getByRole("textbox", { name: "Summary value", exact: true });
}

test("unsaved native field values survive issue and provider switches without crossing targets", async ({
  page,
}) => {
  const writes: string[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name.startsWith("arco_set_")) writes.push(input.name);
    return route.continue();
  });
  await open(page);
  await (await fields(page)).fill("Unsent field for issue 42");
  await app(page)
    .locator(".issue-row")
    .filter({ hasText: secondTitle })
    .click();
  await expect(
    app(page).getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  await expect(await fields(page)).toHaveValue("");
  await (await fields(page)).fill("Unsent field for issue 43");
  await choose(app(page), "Issue source", "linear");
  await expect(
    app(page).getByRole("heading", {
      name: "Keep Linear workflow states intact",
      exact: true,
    }),
  ).toBeVisible();
  await choose(app(page), "Issue source", "github");
  await expect(
    app(page).getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  await expect(await fields(page)).toHaveValue("Unsent field for issue 43");
  await app(page).locator(".issue-row").filter({ hasText: firstTitle }).click();
  await expect(
    app(page).getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(await fields(page)).toHaveValue("Unsent field for issue 42");
  expect(writes).toEqual([]);
});

for (const source of ["github", "linear"] as const) {
  test(`${source} searches debounce typing and wait until IME composition finishes`, async ({
    page,
  }) => {
    const calls: string[] = [];
    const name =
      source === "github" ? "arco_list_issues" : "linear_list_issues";
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { query?: string };
      };
      if (input.name === name && input.arguments.query)
        calls.push(input.arguments.query);
      return route.continue();
    });
    await open(page);
    if (source === "linear") {
      await choose(app(page), "Issue source", "linear");
      await expect(
        app(page).getByRole("heading", {
          name: "Keep Linear workflow states intact",
          exact: true,
        }),
      ).toBeVisible();
    }
    const search = app(page).getByRole("textbox", {
      name: source === "github" ? "Search issues" : "Search Linear Issues",
      exact: true,
    });
    await search.pressSequentially("preserve", { delay: 40 });
    await expect(search).toHaveValue("preserve");
    expect(calls).toEqual([]);
    await expect.poll(() => calls).toEqual(["preserve"]);
    await search.dispatchEvent("compositionstart");
    await search.fill("未確定");
    // Composition may last longer than the debounce delay.
    await page.waitForTimeout(400);
    expect(calls).toEqual(["preserve"]);
    await search.dispatchEvent("compositionend");
    await expect.poll(() => calls).toEqual(["preserve", "未確定"]);
  });
}

test("Retry save persists the failed filter after another preference succeeds", async ({
  page,
}) => {
  const filterWrites: Record<string, unknown>[] = [];
  let fail = true;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { patch?: Record<string, unknown> };
    };
    const patch = input.arguments.patch;
    if (input.name === "arco_update_settings" && patch?.githubFilters) {
      filterWrites.push(patch);
      if (fail) {
        fail = false;
        return route.fulfill({
          json: toolFailure("Settings disk unavailable"),
        });
      }
    }
    return route.continue();
  });
  await open(page);
  await app(page)
    .getByRole("textbox", { name: "Search issues", exact: true })
    .fill("preserve");
  await expect(app(page).locator(".settings-error")).toContainText(
    "Settings disk unavailable",
  );
  await choose(app(page), "Issue source", "linear");
  await expect(
    app(page).getByRole("heading", {
      name: "Keep Linear workflow states intact",
      exact: true,
    }),
  ).toBeVisible();
  await expect(app(page).locator(".settings-error")).toContainText(
    "Settings disk unavailable",
  );
  await app(page)
    .getByRole("button", { name: "Retry save", exact: true })
    .click();
  await expect(app(page).locator(".settings-error")).toBeHidden();
  await expect.poll(() => filterWrites).toHaveLength(2);
  expect(filterWrites[1].githubFilters).toMatchObject({
    "yu/Arco": { query: "preserve" },
  });
});
