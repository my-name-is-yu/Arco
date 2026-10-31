import { expect, test } from "./browser-test";
import { choose, selectControl } from "./select-helpers";
import { toolFailure } from "./tool-failure";

for (const kind of ["issue", "project"] as const) {
  test(`GitHub ${kind} field keeps an acknowledged value when refresh fails and follows later source changes`, async ({
    page,
  }) => {
    const read = kind === "issue" ? "arco_issue_fields" : "arco_project_fields";
    const write =
      kind === "issue" ? "arco_set_issue_field" : "arco_set_project_field";
    const fieldName = kind === "issue" ? "Summary" : "Notes";
    const accepted = "Accepted by the source";
    const latest = "A later value from the source";
    let failReads = false;
    let changedElsewhere = false;
    let writes = 0;
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      if (input.name === write) {
        const response = await route.fetch();
        const result = await response.json();
        expect(result.isError).toBeUndefined();
        writes += 1;
        failReads = true;
        return route.fulfill({ response, json: result });
      }
      if (input.name !== read) return route.continue();
      if (failReads)
        return route.fulfill({
          json: toolFailure("The saved field could not be refreshed."),
        });
      if (!changedElsewhere) return route.continue();
      const response = await route.fetch();
      const result = await response.json();
      const field = result.structuredContent.fields.find(
        (field: { name: string }) => field.name === fieldName,
      );
      field.value = latest;
      return route.fulfill({ response, json: result });
    });
    await page.goto("/?entry=project");
    const ui = page.frameLocator("#arco");
    await ui.getByText("More properties", { exact: true }).click();
    await ui
      .getByText("Edit attributes and membership", { exact: true })
      .click();
    if (kind === "project")
      await ui
        .locator(".project-membership")
        .filter({ hasText: "Arco implementation" })
        .locator("summary")
        .click();
    const field = ui
      .locator(".field-editor")
      .filter({ has: ui.getByText(fieldName, { exact: true }) });
    const input = field.getByRole("textbox", { name: `${fieldName} value` });
    const apply = field.getByRole("button", { name: "Save", exact: true });
    await input.fill(accepted);
    await apply.click();
    await expect(
      ui
        .getByRole("alert")
        .filter({ hasText: "The saved field could not be refreshed." }),
    ).toBeVisible();
    await expect(apply).toBeDisabled();
    await expect(input).toHaveValue(accepted);
    expect(writes).toBe(1);
    failReads = false;
    changedElsewhere = true;
    await ui.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(input).toHaveValue(latest);
    await expect(apply).toBeDisabled();
    expect(writes).toBe(1);
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}

for (const pendingRead of ["list", "issue"] as const) {
  test(`a GitHub save acknowledged inline survives an older hidden ${pendingRead} read and refreshes the reopened list`, async ({
    page,
  }) => {
    let releaseReads!: () => void;
    const pendingReads = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    let releaseWrite!: () => void;
    const pendingWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let releaseLaterIssueReads!: () => void;
    const laterIssueReads = new Promise<void>((resolve) => {
      releaseLaterIssueReads = resolve;
    });
    let holdReads = false;
    let heldRead = false;
    let oldReadReady = false;
    let openListReads = 0;
    let writeAccepted = false;
    let verifyAcceptedCache = false;
    const writes: Record<string, unknown>[] = [];
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { number?: number; state?: string };
      };
      const list = input.name === "arco_list_issues";
      const issue =
        input.name === "arco_get_issue" && input.arguments.number === 43;
      if (list && input.arguments.state === "open") openListReads += 1;
      if (holdReads && !heldRead && (pendingRead === "list" ? list : issue)) {
        heldRead = true;
        const response = await route.fetch();
        oldReadReady = true;
        await pendingReads;
        return route.fulfill({ response });
      }
      if (input.name === "arco_update_issue") {
        writes.push(input.arguments);
        const response = await route.fetch();
        const result = await response.json();
        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toMatchObject({
          number: 43,
          state: "closed",
          stateReason: "completed",
        });
        writeAccepted = true;
        await pendingWrite;
        return route.fulfill({ response, json: result });
      }
      if (issue && verifyAcceptedCache) await laterIssueReads;
      return route.continue();
    });
    try {
      await page.goto(
        "/?entry=project&shared=github&sharedRepo=yu/Arco&sharedNumber=42",
      );
      const ui = page.frameLocator("#arco");
      const title = "Separate shared context from sending a request";
      const row = ui.locator(".issue-row").filter({ hasText: title });
      await row.click();
      await expect(
        ui.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      holdReads = true;
      await ui.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect.poll(() => oldReadReady).toBe(true);
      const beforeSaveListReads = openListReads;
      await choose(ui, "Change issue state", "completed");
      await expect.poll(() => writeAccepted).toBe(true);
      await page
        .getByRole("button", { name: "Mock inline", exact: true })
        .click();
      const card = ui.locator(".inline-mode");
      await expect(
        card.getByRole("heading", {
          name: "Preserve issue selection and scroll position",
          exact: true,
        }),
      ).toBeVisible();
      const acknowledged = page.waitForResponse(
        (response) =>
          response.url().endsWith("/tool") &&
          response.request().postDataJSON().name === "arco_update_issue",
      );
      releaseWrite();
      await acknowledged;
      await ui
        .locator("body")
        .evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
      releaseReads();
      await expect(
        selectControl(card, "Change issue state").getByRole("button"),
      ).not.toHaveAttribute("aria-disabled", "true");
      // A new source read must not hide a stale overwrite of the accepted cache.
      verifyAcceptedCache = true;
      await page
        .getByRole("button", { name: "Mock fullscreen", exact: true })
        .click();
      await expect(row).toHaveCount(0);
      expect(openListReads).toBeGreaterThan(beforeSaveListReads);
      await expect(selectControl(ui, "Change issue state")).toHaveAttribute(
        "data-value",
        "completed",
      );
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        repo: "yu/Arco",
        number: 43,
        patch: { state: "closed", stateReason: "completed" },
      });
      await expect(page.locator("#harness-error")).toBeEmpty();
    } finally {
      releaseWrite();
      releaseReads();
      releaseLaterIssueReads();
    }
  });
}

test("Linear label definitions reset after confirmed create and delete while retaining failed drafts and successful edits", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const createdName = "Recoverable fixture label";
  const updatedName = "Updated fixture label";
  let creates = 0;
  let deletes = 0;
  let labelId = "";
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { action: string };
    };
    if (input.name !== "linear_label_definition") return route.continue();
    if (input.arguments.action === "create") {
      creates += 1;
      if (creates === 1)
        return route.fulfill({
          json: toolFailure("The label creation needs an explicit retry."),
        });
      await pending;
    }
    if (input.arguments.action === "delete" && ++deletes === 1)
      return route.fulfill({
        json: toolFailure("The label deletion needs an explicit retry."),
      });
    const response = await route.fetch();
    const result = await response.json();
    if (input.arguments.action === "create")
      labelId = result.structuredContent.labels.find(
        (label: { name: string }) => label.name === createdName,
      ).id;
    return route.fulfill({ response, json: result });
  });
  try {
    await page.goto("/?source=linear");
    const ui = page.frameLocator("#arco");
    await ui.getByText("More properties", { exact: true }).click();
    const manager = ui.locator(".linear-extra").filter({
      has: ui.getByText("Manage label definitions", { exact: true }),
    });
    await manager.locator("summary").click();
    const name = manager.getByRole("textbox", { name: "Name", exact: true });
    const create = manager.getByRole("button", {
      name: "Create label",
      exact: true,
    });
    await name.fill(createdName);
    await create.click();
    await expect(
      ui
        .getByRole("alert")
        .filter({ hasText: "The label creation needs an explicit retry." }),
    ).toBeVisible();
    await expect(create).toBeEnabled();
    await expect(name).toHaveValue(createdName);
    await create.click();
    for (const label of ["Linear label definition", "Linear label scope"])
      await expect(
        selectControl(manager, label).getByRole("button"),
      ).toHaveAttribute("aria-disabled", "true");
    release();
    await expect(name).toHaveValue("");
    await expect(create).toBeDisabled();
    await expect(
      selectControl(manager, "Linear label definition"),
    ).toHaveAttribute("data-value", "");
    await choose(manager, "Linear label definition", labelId);
    await name.fill(updatedName);
    const apply = manager.getByRole("button", { name: "Save", exact: true });
    await apply.click();
    await expect(apply).toBeEnabled();
    await expect(name).toHaveValue(updatedName);
    await expect(
      selectControl(manager, "Linear label definition"),
    ).toHaveAttribute("data-value", labelId);
    await manager.getByText("Delete definition", { exact: true }).click();
    const remove = manager.getByRole("button", {
      name: "Delete this label definition",
      exact: true,
    });
    await remove.click();
    await expect(
      ui
        .getByRole("alert")
        .filter({ hasText: "The label deletion needs an explicit retry." }),
    ).toBeVisible();
    await expect(remove).toBeEnabled();
    await expect(name).toHaveValue(updatedName);
    await expect(
      selectControl(manager, "Linear label definition"),
    ).toHaveAttribute("data-value", labelId);
    await remove.click();
    await expect(remove).toHaveCount(0);
    await expect(name).toHaveValue("");
    await expect(create).toBeDisabled();
    await expect(
      selectControl(manager, "Linear label definition"),
    ).toHaveAttribute("data-value", "");
    expect(creates).toBe(2);
    expect(deletes).toBe(2);
    await expect(page.locator("#harness-error")).toBeEmpty();
  } finally {
    release();
  }
});
