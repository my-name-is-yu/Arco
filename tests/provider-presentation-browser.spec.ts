import { expect, test } from "@playwright/test";
import { choose, selectControl } from "./select-helpers";

for (const [reason, value, label] of [
  [null, "closed", "Closed"],
  ["future_reason", "closed", "Closed"],
  ["completed", "completed", "Closed · Completed"],
  ["not_planned", "not_planned", "Closed · Not planned"],
] as const) {
  test(`GitHub closed reason ${reason} has the same meaning inline, in details, and in tabs`, async ({
    page,
  }) => {
    const writes: string[] = [];
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON();
      if (input.name === "arco_update_issue") writes.push(input.name);
      if (
        ![
          "arco_get_issue",
          "arco_show_issue",
          "arco_open_issue",
          "arco_show_issues",
        ].includes(input.name)
      )
        return route.continue();
      const response = await route.fetch();
      const result = await response.json();
      const content = result.structuredContent;
      for (const issue of [
        content.issue ?? content,
        ...(content.launch?.issues ?? []),
        ...(result._meta?.issueDetails ?? []),
      ]) {
        if (issue.source === "github") {
          issue.state = "closed";
          issue.stateReason = reason;
        }
      }
      return route.fulfill({ response, json: result });
    });
    const ui = page.frameLocator("#arco");
    for (const entry of ["issue", "detail", "issues"]) {
      await page.goto(`/?entry=${entry}&issueRepo=yu/Arco&number=42`);
      const state = selectControl(ui, "Change issue state");
      await expect(state).toHaveAttribute("data-value", value);
      await expect(state.getByRole("button")).toHaveText(label);
      if (entry === "detail") {
        const reasonText = ui.locator(".issue-kicker > .muted");
        if (value === "closed") await expect(reasonText).toHaveCount(0);
        else
          await expect(reasonText).toHaveText(label.replace("Closed · ", ""));
      }
      if (entry === "issues")
        await expect(ui.getByRole("tab").first()).toHaveAttribute(
          "aria-description",
          label,
        );
      await state.getByRole("button").click();
      if (value === "closed")
        await expect(
          ui.getByRole("option", { name: "Closed", exact: true }),
        ).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Escape");
    }
    expect(writes).toEqual([]);
  });
}

test("Linear priority 3 uses Medium in inline and detail controls without changing its native value", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON();
    if (
      !["arco_show_issue", "arco_open_issue", "linear_get_issue"].includes(
        input.name,
      )
    )
      return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    (result.structuredContent.issue ?? result.structuredContent).priority = 3;
    return route.fulfill({ response, json: result });
  });
  const ui = page.frameLocator("#arco");
  for (const entry of ["issue", "detail"]) {
    await page.goto(`/?entry=${entry}&source=linear&number=42`);
    const priority = selectControl(ui, "Linear Priority");
    await expect(priority).toHaveAttribute("data-value", "3");
    await expect(priority.getByRole("button")).toHaveText("Medium");
  }
});

test("Linear bulk priority and template defaults use Medium for native priority 3", async ({
  page,
}) => {
  await page.goto("/?source=linear");
  const ui = page.frameLocator("#arco");
  await ui
    .getByRole("checkbox", { name: "YU-42 — select for bulk actions" })
    .check();
  const bulk = ui.getByRole("region", { name: "Bulk Linear actions" });
  await choose(bulk, "Bulk Linear action", "priority");
  await choose(bulk, "Bulk Linear priority", "3");
  await expect(
    selectControl(bulk, "Bulk Linear priority").getByRole("button"),
  ).toHaveText("Medium");
  const saved = page.waitForRequest(
    (request) =>
      request.url().endsWith("/tool") &&
      request.postDataJSON().name === "linear_bulk",
  );
  await bulk.getByRole("button", { name: "Apply", exact: true }).click();
  expect((await saved).postDataJSON().arguments).toMatchObject({
    patch: { priority: 3 },
  });
  await expect(selectControl(ui, "Linear Priority")).toHaveAttribute(
    "data-value",
    "3",
  );
  await ui
    .getByRole("button", { name: "Create Linear Issue", exact: true })
    .click();
  const dialog = ui.getByRole("dialog", { name: "Create Linear Issue" });
  await choose(dialog, "Linear template", "linear-simple-template");
  const defaults = dialog.getByText("Initial template attributes", {
    exact: true,
  });
  await defaults.click();
  await expect(
    dialog.locator("dl > div").filter({ hasText: "Priority" }).locator("dd"),
  ).toHaveText("Medium");
});
