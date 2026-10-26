import { expect, test, type Page } from "./browser-test";
import type {
  FieldValue,
  IssueFieldList,
  ProjectField,
  ProjectFieldList,
} from "../src/shared/github-operations";
import { choose, selectControl } from "./select-helpers";

async function openAttributes(page: Page) {
  await page.goto("/?entry=project");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  const ui = page.frameLocator("#arco");
  await choose(ui, "GitHub view", "yu/Arco");
  await ui
    .locator(".issue-row")
    .filter({ hasText: "Preserve issue selection and scroll position" })
    .click();
  await ui.getByText("More properties", { exact: true }).click();
  await ui.getByText("Edit attributes and membership", { exact: true }).click();
  return ui;
}

async function projectFields(
  page: Page,
  values: Map<string, FieldValue>,
  extras: ProjectField[] = [],
) {
  const writes: { fieldId: string; value: FieldValue }[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { fieldId: string; value: FieldValue };
    };
    if (input.name === "arco_set_project_field") {
      writes.push({
        fieldId: input.arguments.fieldId,
        value: input.arguments.value,
      });
      values.set(input.arguments.fieldId, input.arguments.value);
    }
    if (input.name !== "arco_project_fields") return route.continue();
    const response = await route.fetch();
    const result = (await response.json()) as {
      structuredContent: ProjectFieldList;
    };
    for (const field of result.structuredContent.fields)
      if (values.has(field.id)) field.value = values.get(field.id)!;
    result.structuredContent.fields.push(...extras);
    return route.fulfill({ response, json: result });
  });
  const ui = await openAttributes(page);
  const project = ui
    .locator(".project-membership")
    .filter({ has: ui.getByText("Arco implementation", { exact: true }) });
  await project.locator("summary").click();
  await expect(selectControl(project, "Status value")).toBeVisible();
  return { ui, project, writes };
}

test("Organization Issue fields retain fetched names when current choices are missing", async ({
  page,
}) => {
  const writes: FieldValue[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { fieldId: number; value: FieldValue };
    };
    if (
      input.name === "arco_set_issue_field" &&
      input.arguments.fieldId === 105
    )
      writes.push(input.arguments.value);
    if (input.name !== "arco_issue_fields") return route.continue();
    const response = await route.fetch();
    const result = (await response.json()) as {
      structuredContent: IssueFieldList;
    };
    for (const field of result.structuredContent.fields) {
      if (field.id === 104) {
        field.value = "High";
        field.options = field.options.filter(
          (option) => option.name !== "High",
        );
      }
      if (field.id === 105) {
        field.value = ["Frontend", "Server"];
        field.options = field.options.filter(
          (option) => option.name !== "Frontend",
        );
      }
    }
    return route.fulfill({ response, json: result });
  });
  const ui = await openAttributes(page);
  const priority = selectControl(ui, "Priority value");
  await expect(priority).toContainText("High");
  await priority.getByRole("button").click();
  await expect(
    ui.getByRole("option", { name: "High", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await choose(ui, "Priority value", "Normal");
  const area = ui
    .locator(".field-editor")
    .filter({ has: selectControl(ui, "Area") });
  await expect(area).toContainText("Frontend");
  await expect(area).toContainText("Server");
  await selectControl(area, "Area").getByRole("button").click();
  await expect(
    ui.getByRole("option", { name: "Frontend", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await ui.getByRole("option", { name: "Server", exact: true }).click();
  await page.keyboard.press("Escape");
  await area.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => writes).toEqual([["Frontend"]]);
});

test("Project field conflicts show native option and iteration names while saving native IDs", async ({
  page,
}) => {
  const values = new Map<string, FieldValue>([
    ["fixture-status-field", "fixture-status-progress"],
    ["fixture-project-iteration", null],
  ]);
  const { ui, project, writes } = await projectFields(page, values);
  await choose(project, "Status value", "fixture-status-todo");
  await choose(project, "Iteration iteration", "fixture-iteration-1");
  values.set("fixture-status-field", "fixture-status-done");
  values.set("fixture-project-iteration", "fixture-iteration-2");
  await ui.getByRole("button", { name: "Refresh", exact: true }).click();
  const status = project.locator(".field-editor").filter({
    has: selectControl(ui, "Status value"),
  });
  const iteration = project.locator(".field-editor").filter({
    has: selectControl(ui, "Iteration iteration"),
  });
  await expect(status.locator(".inline-error")).toContainText("Done");
  await expect(status.locator(".inline-error")).not.toContainText(
    "fixture-status-done",
  );
  await expect(iteration.locator(".inline-error")).toContainText("November 1");
  await expect(iteration.locator(".inline-error")).not.toContainText(
    "fixture-iteration-2",
  );
  await status
    .getByRole("button", {
      name: "Keep draft after reviewing the latest value",
      exact: true,
    })
    .click();
  await status.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => writes)
    .toContainEqual({
      fieldId: "fixture-status-field",
      value: "fixture-status-todo",
    });
  await expect(selectControl(status, "Status value")).toContainText("Todo");
});

test("unknown Project conflict values use a generic message without exposing internal IDs", async ({
  page,
}) => {
  const values = new Map<string, FieldValue>([
    ["fixture-status-field", "fixture-status-progress"],
  ]);
  const { ui, project } = await projectFields(page, values);
  await choose(project, "Status value", "fixture-status-todo");
  values.set("fixture-status-field", "unavailable-internal-option-id");
  await ui.getByRole("button", { name: "Refresh", exact: true }).click();
  const status = project.locator(".field-editor").filter({
    has: selectControl(ui, "Status value"),
  });
  await expect(status.locator(".inline-error")).toContainText(
    "The value on GitHub changed.",
  );
  await expect(status).not.toContainText("unavailable-internal-option-id");
  await expect(
    status.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(selectControl(status, "Status value")).toContainText("Todo");
});

test("unsupported Project fields direct users to GitHub without raw types or a false empty value", async ({
  page,
}) => {
  const { project } = await projectFields(page, new Map(), [
    {
      id: "unsupported-project-field",
      name: "Linked pull requests",
      type: "linked_pull_requests",
      supported: false,
      value: null,
      options: [],
      iterations: [],
    },
  ]);
  const unsupported = project
    .locator(".field-editor")
    .filter({ hasText: "Linked pull requests" });
  await expect(unsupported).toContainText(
    "View and edit this field on GitHub.",
  );
  await expect(unsupported).not.toContainText("linked_pull_requests");
  await expect(unsupported).not.toContainText("Not set");
  await expect(
    unsupported.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
});
