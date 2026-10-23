import { expect, test, type Page } from "@playwright/test";
import { choose, selectControl } from "./select-helpers";

const frame = (page: Page) => page.frameLocator("#arco");
type Input = {
  session: string;
  name: string;
  arguments: Record<string, unknown>;
};
async function events(page: Page, type: string) {
  const entries: { type: string; value: unknown }[] = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  );
  return entries
    .filter((entry) => entry.type === type)
    .map((entry) => entry.value);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await expect(
    frame(page).getByRole("heading", {
      name: "Preserve issue selection and scroll position",
      exact: true,
    }),
  ).toBeVisible();
  await expect(frame(page).locator(".sidebar-footer")).toContainText(
    "Local fixture",
  );
});

test("GitHub URL opens a different repository from account mode, and the optional repository entry opens Issue URLs", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as Input;
    if (
      input.name !== "arco_get_issue" ||
      input.arguments.repo !== "other/project"
    )
      return route.continue();
    expect(input.arguments.number).toBe(7);
    const response = await route.fetch({
      postData: JSON.stringify({
        ...input,
        arguments: { repo: "yu/Arco", number: 42 },
      }),
    });
    const result = await response.json();
    return route.fulfill({
      response,
      json: {
        ...result,
        structuredContent: {
          ...result.structuredContent,
          repo: "other/project",
          number: 7,
          id: "fixture-other-7",
          title: "Cross repository URL target",
          url: "https://github.com/other/project/issues/7",
          body: "Cross-repository fixture target.",
          comments: [],
          projects: [],
        },
      },
    });
  });
  const search = frame(page).getByRole("textbox", {
    name: "Search issues",
    exact: true,
  });
  await search.evaluate((element) => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      "https://github.com/other/project/issues/7#issuecomment-1",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(
    frame(page).getByRole("heading", {
      name: "Cross repository URL target",
      exact: true,
    }),
  ).toBeVisible();
  await expect(selectControl(frame(page), "GitHub scope")).toHaveAttribute(
    "data-value",
    "other/project",
  );
  await frame(page).getByText("Add repository", { exact: true }).click();
  await frame(page)
    .getByRole("textbox", { name: "Repository or URL" })
    .fill("https://github.com/yu/Arco/issues/43");
  await frame(page)
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await expect(
    frame(page).getByRole("heading", {
      name: "Separate shared context from sending a request",
      exact: true,
    }),
  ).toBeVisible();
  const calls = (await events(page, "tool")) as Input[];
  expect(
    calls.some(
      (call) =>
        call.name === "arco_get_issue" &&
        call.arguments.repo === "other/project" &&
        call.arguments.number === 7,
    ),
  ).toBe(true);
  expect(
    calls
      .filter((call) => call.name === "arco_list_issues")
      .every((call) => !String(call.arguments.query).includes("https://")),
  ).toBe(true);
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
  expect(
    calls.some((call) =>
      /arco_(?:create_issue|update_issue|add_comment|change_labels)/.test(
        call.name,
      ),
    ),
  ).toBe(false);
});

test("invalid GitHub URLs remain visible without source lookup, and normal title search still works", async ({
  page,
}) => {
  const search = frame(page).getByRole("textbox", {
    name: "Search issues",
    exact: true,
  });
  for (const url of [
    "https://github.com.evil.test/other/project/issues/7",
    "https://github.com/other/project/pull/7",
  ]) {
    await search.fill(url);
    await search.press("Enter");
    await expect(frame(page).locator("#github-search-error")).toBeVisible();
    await expect(search).toHaveValue(url);
  }
  const calls = (await events(page, "tool")) as Input[];
  // The initial host result can independently refresh the already-open issue.
  // Invalid URL targets must never become source lookups.
  expect(
    new Set(
      calls
        .filter((call) => call.name === "arco_get_issue")
        .map((call) => `${call.arguments.repo}#${call.arguments.number}`),
    ),
  ).toEqual(new Set(["yu/Arco#42"]));
  await expect(
    frame(page).getByRole("heading", {
      name: "Preserve issue selection and scroll position",
      exact: true,
    }),
  ).toBeVisible();
  await choose(frame(page), "GitHub scope", "yu/Arco");
  await search.fill("Separate shared context");
  await expect(frame(page).locator(".issue-sidebar .issue-row")).toHaveCount(1);
  await expect(frame(page).locator(".issue-sidebar .issue-row")).toContainText(
    "Separate shared context from sending a request",
  );
});

test("Linear resolves a native URL to a different team and leaves malformed or denied input intact", async ({
  page,
}) => {
  const other = {
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-other-team",
    issueId: "fixture-other-7",
  };
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as Input;
    let request = input;
    if (
      input.name === "linear_resolve_issue" &&
      input.arguments.url === "https://linear.app/fixture/issue/OT-7/a-title"
    )
      request = {
        ...input,
        arguments: {
          connectionId: "default",
          url: "https://linear.app/fixture/issue/YU-43",
        },
      };
    else if (
      input.name === "linear_get_issue" &&
      input.arguments.issueId === other.issueId
    )
      request = {
        ...input,
        arguments: {
          ...other,
          teamId: "fixture-linear-team",
          issueId: "fixture-linear-43",
        },
      };
    else if (
      input.name === "linear_metadata" &&
      input.arguments.teamId === other.teamId
    )
      request = {
        ...input,
        arguments: { ...input.arguments, teamId: "fixture-linear-team" },
      };
    else if (
      input.name === "linear_list_issues" &&
      input.arguments.teamId === other.teamId
    )
      return route.fulfill({
        json: {
          content: [{ type: "text", text: "Other-team fixture page." }],
          structuredContent: { issues: [], cursor: null, hasMore: false },
        },
      });
    else if (input.name !== "linear_scopes") return route.continue();
    const response = await route.fetch({ postData: JSON.stringify(request) });
    const result = await response.json();
    if (input.name === "linear_scopes")
      result.structuredContent.teams.push({
        id: other.teamId,
        name: "Other team",
        key: "OT",
      });
    else if (input.name === "linear_resolve_issue")
      result.structuredContent = other;
    else if (input.name === "linear_get_issue")
      result.structuredContent = {
        ...result.structuredContent,
        ...other,
        identifier: "OT-7",
        title: "Cross team URL target",
        url: "https://linear.app/fixture/issue/OT-7",
        body: "Other-team fixture issue.",
        labels: [],
        comments: [],
        project: null,
        cycle: null,
      };
    return route.fulfill({ response, json: result });
  });
  await choose(frame(page), "Issue source", "linear");
  const search = frame(page).getByRole("textbox", {
    name: "Search Linear Issues",
    exact: true,
  });
  await search.fill("https://linear.app/fixture/issue/OT-7/a-title");
  await search.press("Enter");
  await expect(
    frame(page).getByRole("heading", {
      name: "Cross team URL target",
      exact: true,
    }),
  ).toBeVisible();
  await expect(selectControl(frame(page), "Linear Team")).toHaveAttribute(
    "data-value",
    other.teamId,
  );
  for (const url of [
    "https://linear.app.evil.test/fixture/issue/OT-7",
    "https://linear.app/fixture/issue/YU-99999",
  ]) {
    await search.fill(url);
    await search.press("Enter");
    await expect(frame(page).locator("#linear-search-error")).toBeVisible();
    await expect(search).toHaveValue(url);
    await expect(
      frame(page).getByRole("heading", {
        name: "Cross team URL target",
        exact: true,
      }),
    ).toBeVisible();
  }
  const calls = (await events(page, "tool")) as Input[];
  expect(
    calls.some(
      (call) =>
        call.name === "linear_get_issue" &&
        call.arguments.issueId === other.issueId &&
        call.arguments.teamId === other.teamId,
    ),
  ).toBe(true);
  expect(
    calls
      .filter((call) => call.name === "linear_list_issues")
      .every((call) => !String(call.arguments.query).includes("https://")),
  ).toBe(true);
  expect(
    calls.some(
      (call) =>
        call.name === "linear_resolve_issue" &&
        String(call.arguments.url).includes("evil.test"),
    ),
  ).toBe(false);
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
});
