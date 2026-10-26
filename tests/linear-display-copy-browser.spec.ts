import { expect, test, type Page } from "./browser-test";
import { choose, selectControl } from "./select-helpers";
import { toolFailure } from "./tool-failure";

const firstTitle = "Keep Linear workflow states intact";
const secondTitle = "Share a Linear issue with the Codex chat";
const app = (page: Page) => page.frameLocator("#arco");

async function open(page: Page, title = firstTitle, url = "/?entry=project") {
  await page.goto(url);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await choose(app(page), "Issue source", "linear");
  await app(page).locator(".issue-row").filter({ hasText: title }).click();
  await expect(
    app(page).getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
}

test("Linear retains current project, cycle and milestone names when metadata cannot load", async ({
  page,
}) => {
  const current = [
    {
      property: "project",
      id: "edbe24dc-90db-4a9f-8775-9fcc7be1d123",
      name: "Current project",
    },
    {
      property: "cycle",
      id: "37b18f98-eb5e-40cf-8b48-d9ef9574766b",
      name: "Current cycle",
    },
    {
      property: "projectMilestone",
      id: "2e6c537b-d5a3-4994-becc-3532785cd0af",
      name: "Current milestone",
    },
  ];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON();
    if (input.name === "linear_metadata")
      return route.fulfill({
        json: toolFailure("Choices are temporarily unavailable."),
      });
    if (
      input.name === "linear_get_issue" &&
      input.arguments.issueId === "fixture-linear-42"
    ) {
      const response = await route.fetch();
      const result = await response.json();
      for (const { property, id, name } of current)
        result.structuredContent[property] = { id, name };
      return route.fulfill({ response, json: result });
    }
    await route.continue();
  });
  await open(page);
  const ui = app(page);
  await expect(
    ui
      .getByRole("alert")
      .filter({ hasText: "Choices are temporarily unavailable." }),
  ).toBeVisible();
  await ui.getByText("More properties", { exact: true }).click();
  for (const { property, id, name } of current) {
    const control = selectControl(
      ui,
      property === "projectMilestone"
        ? "Linear project milestone"
        : `Linear ${property}`,
    );
    await expect(control.getByRole("button")).toContainText(name);
    await expect(control).not.toContainText(id);
    await control.getByRole("button").click();
    await expect(ui.getByRole("option", { name, exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.keyboard.press("Escape");
  }
});

test("Linear keeps the selected label definition name when it disappears from metadata", async ({
  page,
}) => {
  let omitLabels = false;
  await page.route("**/tool", async (route) => {
    if (route.request().postDataJSON().name !== "linear_metadata")
      return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    if (omitLabels) result.structuredContent.labels = [];
    await route.fulfill({ response, json: result });
  });
  await open(page);
  const ui = app(page);
  await ui.getByText("More properties", { exact: true }).click();
  await ui.getByText("Manage label definitions", { exact: true }).click();
  const manager = ui
    .locator("details.linear-extra")
    .filter({ hasText: "Manage label definitions" });
  await choose(manager, "Linear label definition", "linear-label-design");
  await expect(
    manager.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Design");
  omitLabels = true;
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/tool") &&
      response.request().postDataJSON().name === "linear_metadata",
  );
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  await refreshed;
  const control = selectControl(manager, "Linear label definition");
  await expect(control.getByRole("button")).toHaveText("Design");
  await expect(control).not.toContainText("linear-label-design");
  await expect(
    manager.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Design");
  await control.getByRole("button").click();
  await expect(
    ui.getByRole("option", { name: "Design", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
});

test("Linear milestone search and relation inputs use display names while retaining native values", async ({
  page,
}) => {
  const milestoneId = "700a5086-9db6-472a-84f5-cbc30dd9dfce";
  const writes: string[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON();
    if (input.name === "linear_update_issue") {
      writes.push(input.name);
      return route.fulfill({
        json: toolFailure("This test does not perform source writes."),
      });
    }
    if (
      input.name !== "linear_metadata" &&
      !(
        input.name === "linear_get_issue" &&
        input.arguments.issueId === "fixture-linear-42"
      )
    )
      return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    if (input.name === "linear_metadata")
      result.structuredContent.milestones = Array.from(
        { length: 16 },
        (_, index) => ({
          id: index === 7 ? milestoneId : `fixture-milestone-${index}`,
          name: index === 7 ? "Selected milestone" : `Milestone ${index + 1}`,
          projectId: "linear-project",
        }),
      );
    else
      result.structuredContent.projectMilestone = {
        id: milestoneId,
        name: "Selected milestone",
      };
    await route.fulfill({ response, json: result });
  });
  await open(page);
  const ui = app(page);
  await ui.getByText("More properties", { exact: true }).click();
  const milestone = selectControl(ui, "Linear project milestone");
  await expect(milestone).toHaveAttribute("data-value", milestoneId);
  await milestone.getByRole("button").click();
  const search = ui.getByRole("combobox");
  await expect(search).toHaveAttribute("placeholder", "Search…");
  await search.fill("Selected milestone");
  const option = ui.getByRole("option", {
    name: "Selected milestone",
    exact: true,
  });
  await expect(option.locator("[data-select-value]")).toHaveAttribute(
    "data-select-value",
    milestoneId,
  );
  await option.click();
  await expect(milestone).toHaveAttribute("data-value", milestoneId);
  await expect(milestone.getByRole("button")).toContainText(
    "Selected milestone",
  );
  await ui
    .getByText("Parent, sub-issues and relations", { exact: true })
    .click();
  const parent = ui.getByRole("textbox", {
    name: "Linear parent issue",
    exact: true,
  });
  const related = ui.getByRole("textbox", {
    name: "Related Linear issue",
    exact: true,
  });
  await expect(parent).toHaveAttribute(
    "placeholder",
    "Parent issue (e.g. ABC-123)",
  );
  await expect(related).toHaveAttribute(
    "placeholder",
    "Related issue (e.g. ABC-123)",
  );
  await parent.fill("ABC-123");
  await related.fill("ABC-456");
  await expect(parent).toHaveValue("ABC-123");
  await expect(related).toHaveValue("ABC-456");
  expect(writes).toEqual([]);
});

for (const sharedNumber of [42, 999]) {
  test(`Linear shared issue ${sharedNumber} uses known names or a neutral label when its detail cannot load`, async ({
    page,
  }) => {
    const issueId = `fixture-linear-${sharedNumber}`;
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON();
      if (
        input.name === "linear_get_issue" &&
        input.arguments.issueId === issueId
      )
        return route.fulfill({
          json: toolFailure("This issue is temporarily unavailable."),
        });
      await route.continue();
    });
    await open(
      page,
      secondTitle,
      `/?entry=project&shared=linear&sharedNumber=${sharedNumber}`,
    );
    const chip = app(page).locator(".shared-chip");
    await expect(chip).toHaveText(
      sharedNumber === 42 ? "Chat: YU-42" : "Shared issue",
    );
    await expect(chip).not.toContainText(issueId);
    await expect(chip).not.toHaveAttribute("title", new RegExp(issueId));
    await expect(chip).not.toHaveAttribute("aria-label", new RegExp(issueId));
  });
}
