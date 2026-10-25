import { expect, test, type Page } from "@playwright/test";
import type { ProjectFieldList } from "../src/shared/github-operations";
import { choose, selectControl } from "./select-helpers";

async function openProjectFields(page: Page) {
  await page.goto("/?entry=detail&issueRepo=yu/Arco&number=42");
  const ui = page.frameLocator("#arco");
  await ui.getByText("More properties", { exact: true }).click();
  await ui.getByText("Edit attributes and membership", { exact: true }).click();
  const project = ui.locator(".project-membership");
  await project.locator("summary").click();
  await expect(selectControl(project, "Status value")).toBeVisible();
  return { ui, project, status: selectControl(project, "Status value") };
}

test("a missing selection keeps its last known name, accepts a refreshed name, and saves the native value", async ({
  page,
}) => {
  let missing = false;
  let renamed = false;
  const writes: unknown[] = [];
  await page.route("**/tool", async (route) => {
    const call = route.request().postDataJSON() as {
      name: string;
      arguments: unknown;
    };
    if (call.name === "arco_set_project_field") writes.push(call.arguments);
    if (call.name !== "arco_project_fields") return route.continue();
    const response = await route.fetch();
    const result = (await response.json()) as {
      structuredContent: ProjectFieldList;
    };
    const field = result.structuredContent.fields.find(
      (field) => field.id === "fixture-status-field",
    )!;
    field.options = missing
      ? []
      : field.options.map((option) => ({
          ...option,
          name:
            renamed && option.id === "fixture-status-progress"
              ? "In development"
              : option.name,
        }));
    return route.fulfill({ response, json: result });
  });
  const { ui, project, status } = await openProjectFields(page);
  await expect(status).toContainText("In progress");
  missing = true;
  await ui.getByRole("button", { name: "Refresh", exact: true }).click();
  await status.getByRole("button").click();
  await expect(
    ui.getByRole("option", { name: "In progress", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    ui.getByRole("option", { name: "Todo", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(status).toHaveAttribute("data-value", "fixture-status-progress");
  await expect(status).toContainText("In progress");
  await expect(status).not.toContainText("fixture-status-progress");
  expect(writes).toHaveLength(0);
  missing = false;
  renamed = true;
  await ui.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(status).toContainText("In development");
  await choose(project, "Status value", "fixture-status-todo");
  await project
    .locator(".field-editor")
    .filter({ has: selectControl(ui, "Status value") })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect
    .poll(() => writes)
    .toEqual([
      expect.objectContaining({
        fieldId: "fixture-status-field",
        value: "fixture-status-todo",
      }),
    ]);
});

test("an unresolved initial selection stays selected without exposing its ID or initiating a write", async ({
  page,
}) => {
  const internalId = "c5b8873d-80d3-4d25-b8e7-05e69f6b4220";
  let writes = 0;
  await page.route("**/tool", async (route) => {
    const call = route.request().postDataJSON() as { name: string };
    if (call.name === "arco_set_project_field") writes++;
    if (call.name !== "arco_project_fields") return route.continue();
    const response = await route.fetch();
    const result = (await response.json()) as {
      structuredContent: ProjectFieldList;
    };
    const field = result.structuredContent.fields.find(
      (field) => field.id === "fixture-status-field",
    )!;
    field.value = internalId;
    field.options = [];
    return route.fulfill({ response, json: result });
  });
  const { project, status } = await openProjectFields(page);
  await expect(status).toContainText("Unavailable selection");
  await expect(status).toHaveAttribute("data-value", internalId);
  await expect(project).not.toContainText(internalId);
  await status.getByRole("button").click();
  const option = page
    .frameLocator("#arco")
    .getByRole("option", { name: "Unavailable selection", exact: true });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect(option).toHaveAttribute("aria-disabled", "true");
  expect(writes).toBe(0);
});
