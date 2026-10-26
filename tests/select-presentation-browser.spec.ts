import { expect, test, type Locator, type Page } from "./browser-test";
import type { LinearIssue } from "../src/shared/linear";
import { choose, selectControl } from "./select-helpers";

type Source = "github" | "linear";
const app = (page: Page) => page.frameLocator("#arco");
const titles = {
  github: [
    "Preserve issue selection and scroll position",
    "Separate shared context from sending a request",
  ],
  linear: [
    "Keep Linear workflow states intact",
    "Share a Linear issue with the Codex chat",
  ],
};
const scope = {
  connectionId: "default",
  workspaceId: "fixture-linear-workspace",
  teamId: "fixture-linear-team",
};

async function fixtureTool<T>(
  page: Page,
  session: string,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await page.request.post("/tool", {
    data: { session, name, arguments: args },
  });
  expect(response.ok()).toBe(true);
  const result = (await response.json()) as {
    isError?: boolean;
    structuredContent: T;
  };
  expect(result.isError).not.toBe(true);
  return result.structuredContent;
}

async function session(page: Page) {
  const response = await page.request.post("/session");
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { session: string }).session;
}

async function open(page: Page, source: Source, id?: string) {
  const sessionId = id ?? (await session(page));
  await page.goto(`/?entry=project&session=${sessionId}`);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  if (source === "linear") await choose(app(page), "Issue source", "linear");
  await app(page)
    .locator(".issue-row")
    .filter({ hasText: titles[source][0] })
    .click();
  await expect(
    app(page).getByRole("heading", { name: titles[source][0], exact: true }),
  ).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
  return sessionId;
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((theme) => {
    document
      .querySelector<HTMLIFrameElement>("#arco")!
      .contentWindow!.postMessage(
        {
          jsonrpc: "2.0",
          method: "ui/notifications/host-context-changed",
          params: { theme },
        },
        "*",
      );
  }, theme);
  await expect(app(page).locator(".arco")).toHaveCSS(
    "background-color",
    theme === "dark" ? "rgb(25, 25, 25)" : "rgb(255, 255, 255)",
  );
}

async function palette(page: Page) {
  const ui = app(page);
  return {
    text: await ui
      .locator(".arco")
      .evaluate((element) => getComputedStyle(element).color),
    muted: await ui
      .getByRole("heading", { name: "Labels", exact: true })
      .evaluate((element) => getComputedStyle(element).color),
  };
}

const selectedText = (control: Locator) =>
  control.getByRole("button").locator(".source-select-text").first();

async function emptySecondIssue(page: Page, id: string, source: Source) {
  if (source === "github") {
    await fixtureTool(page, id, "arco_change_labels", {
      repo: "yu/Arco",
      number: 43,
      remove: ["enhancement"],
      requestId: crypto.randomUUID(),
    });
  } else {
    const issue = await fixtureTool<LinearIssue>(page, id, "linear_get_issue", {
      ...scope,
      issueId: "fixture-linear-43",
    });
    await fixtureTool(page, id, "linear_update_issue", {
      ...scope,
      issueId: issue.issueId,
      expectedUpdatedAt: issue.updatedAt,
      patch: { assigneeId: null },
      requestId: crypto.randomUUID(),
    });
  }
}

for (const source of ["github", "linear"] as const) {
  test(`${source} selected text matches body text and empty values stay muted in details and cards`, async ({
    page,
  }) => {
    const id = await session(page);
    await emptySecondIssue(page, id, source);
    await open(page, source, id);
    const ui = app(page);
    const assigneeName = source === "github" ? "Assignees" : "Linear assignee";
    for (const theme of ["dark", "light"] as const) {
      await setTheme(page, theme);
      const colors = await palette(page);
      expect(colors.text).not.toBe(colors.muted);
      await expect(selectedText(selectControl(ui, assigneeName))).toHaveCSS(
        "color",
        colors.text,
      );
      await expect(selectedText(selectControl(ui, "Labels"))).toHaveCSS(
        "color",
        colors.text,
      );
      await page
        .getByRole("button", { name: "Mock inline", exact: true })
        .click();
      await setTheme(page, theme);
      const card = ui.locator(".inline-mode");
      await expect(selectedText(selectControl(card, assigneeName))).toHaveCSS(
        "color",
        colors.text,
      );
      await expect(selectedText(selectControl(card, "Labels"))).toHaveCSS(
        "color",
        colors.text,
      );
      await ui
        .getByRole("button", { name: "Open details", exact: true })
        .click();
      await ui
        .locator(".issue-row")
        .filter({ hasText: titles[source][1] })
        .click();
      await setTheme(page, theme);
      await expect(selectedText(selectControl(ui, assigneeName))).toHaveCSS(
        "color",
        colors.muted,
      );
      await expect(selectedText(selectControl(ui, "Labels"))).toHaveCSS(
        "color",
        colors.muted,
      );
      await page
        .getByRole("button", { name: "Mock inline", exact: true })
        .click();
      await setTheme(page, theme);
      await expect(selectedText(selectControl(card, assigneeName))).toHaveCSS(
        "color",
        colors.muted,
      );
      await expect(selectedText(selectControl(card, "Labels"))).toHaveCSS(
        "color",
        colors.muted,
      );
      await ui
        .getByRole("button", { name: "Open details", exact: true })
        .click();
      await ui
        .locator(".issue-row")
        .filter({ hasText: titles[source][0] })
        .click();
    }
  });
}

test("GitHub detail selections retain every label color and match the state and assignee menu icons", async ({
  page,
}) => {
  await open(page, "github");
  const ui = app(page);
  const labels = selectControl(ui, "Labels");
  const selected = labels.locator(".source-selected-value");
  await expect(selected).toHaveCount(2);
  await expect(selected.nth(0).locator(".property-label-dot")).toHaveCSS(
    "background-color",
    "rgb(162, 238, 239)",
  );
  await expect(selected.nth(1).locator(".property-label-dot")).toHaveCSS(
    "background-color",
    "rgb(197, 222, 245)",
  );
  await labels.getByRole("button").click();
  for (const name of ["enhancement", "design"]) {
    const option = ui.getByRole("option", { name, exact: true });
    const current = selected.filter({ hasText: name });
    await expect(option.locator(".property-label-dot")).toHaveCSS(
      "background-color",
      await current
        .locator(".property-label-dot")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    );
  }
  await page.keyboard.press("Escape");
  const state = selectControl(ui, "Change issue state");
  await expect(state.locator(".property-state-icon")).toHaveAttribute(
    "data-state",
    "open",
  );
  await state.getByRole("button").click();
  await expect(
    ui
      .getByRole("option", { name: "Open", exact: true })
      .locator(".property-state-icon"),
  ).toHaveCSS(
    "color",
    await state
      .locator(".property-state-icon")
      .evaluate((element) => getComputedStyle(element).color),
  );
  await page.keyboard.press("Escape");
  const assignees = selectControl(ui, "Assignees");
  await expect(assignees.locator(".property-assignee-mark")).toHaveText("FI");
  await assignees.getByRole("button").click();
  await expect(
    ui
      .getByRole("option", { name: "fixture-user", exact: true })
      .locator(".property-assignee-mark"),
  ).toHaveText("FI");
  await page.keyboard.press("Escape");
  const projectStatus = selectControl(ui, "Arco implementation status");
  const statusColor = await projectStatus
    .locator(".property-label-dot")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(statusColor).not.toBe("rgba(0, 0, 0, 0)");
  await projectStatus.getByRole("button").click();
  await expect(
    ui
      .getByRole("option", { name: "In progress", exact: true })
      .locator(".property-label-dot"),
  ).toHaveCSS("background-color", statusColor);
  expect(
    await ui
      .getByRole("option", { name: "Todo", exact: true })
      .locator(".property-label-dot")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).not.toBe(statusColor);
});

test("Linear detail trigger and menu preserve workflow, assignee, priority and label visuals", async ({
  page,
}) => {
  const id = await open(page, "linear");
  await fixtureTool(page, id, "linear_change_labels", {
    ...scope,
    issueId: "fixture-linear-42",
    add: ["linear-label-bug"],
    requestId: crypto.randomUUID(),
  });
  const ui = app(page);
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  const labels = selectControl(ui, "Labels");
  await expect(labels.locator(".source-selected-value")).toHaveCount(2);
  await expect(labels.locator(".property-label-dot").nth(0)).toHaveCSS(
    "background-color",
    "rgb(197, 222, 245)",
  );
  await expect(labels.locator(".property-label-dot").nth(1)).toHaveCSS(
    "background-color",
    "rgb(215, 58, 74)",
  );
  const state = selectControl(ui, "Linear Workflow state");
  await expect(state.locator(".property-state-icon")).toHaveCSS(
    "color",
    "rgb(242, 201, 76)",
  );
  await state.getByRole("button").click();
  await expect(
    ui
      .getByRole("option", { name: "In Progress", exact: true })
      .locator(".property-state-icon"),
  ).toHaveCSS("color", "rgb(242, 201, 76)");
  await page.keyboard.press("Escape");
  const assignee = selectControl(ui, "Linear assignee");
  await expect(assignee.locator(".property-assignee-mark")).toHaveText("FU");
  await assignee.getByRole("button").click();
  await expect(
    ui
      .getByRole("option", { name: "Fixture user", exact: true })
      .locator(".property-assignee-mark"),
  ).toHaveText("FU");
  await page.keyboard.press("Escape");
  const priority = selectControl(ui, "Linear Priority");
  await expect(priority.locator(".property-priority-icon")).toHaveAttribute(
    "data-priority",
    "2",
  );
  await priority.getByRole("button").click();
  await expect(
    ui
      .getByRole("option", { name: "High", exact: true })
      .locator(".property-priority-icon"),
  ).toHaveAttribute("data-priority", "2");
});

test("Linear no-priority stays empty-colored while a valid zero estimate uses the body color", async ({
  page,
}) => {
  const id = await session(page);
  const issue = await fixtureTool<LinearIssue>(page, id, "linear_get_issue", {
    ...scope,
    issueId: "fixture-linear-42",
  });
  await fixtureTool(page, id, "linear_update_issue", {
    ...scope,
    issueId: issue.issueId,
    expectedUpdatedAt: issue.updatedAt,
    patch: { priority: 0, estimate: 0 },
    requestId: crypto.randomUUID(),
  });
  await open(page, "linear", id);
  const ui = app(page);
  await ui.getByText("More properties", { exact: true }).click();
  for (const theme of ["dark", "light"] as const) {
    await setTheme(page, theme);
    const colors = await palette(page);
    const priority = selectControl(ui, "Linear Priority");
    const estimate = selectControl(ui, "Linear Estimate");
    await expect(priority.getByRole("button")).toHaveText("No priority");
    await expect(selectedText(priority)).toHaveCSS("color", colors.muted);
    await expect(estimate.getByRole("button")).toHaveText("0");
    await expect(selectedText(estimate)).toHaveCSS("color", colors.text);
  }
});

test("GitHub and Linear show one divider between Labels and More properties at wide and narrow widths", async ({
  page,
}) => {
  for (const source of ["github", "linear"] as const) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, source);
    const ui = app(page);
    await ui
      .locator(".issue-row")
      .filter({ hasText: titles[source][0] })
      .click();
    const labels = ui.locator(".issue-properties > section").filter({
      has: ui.getByRole("heading", { name: "Labels", exact: true }),
    });
    const more = ui.locator(".issue-properties > .property-advanced");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(labels).toBeVisible();
      const bottom = await labels.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).borderBottomWidth),
      );
      const top = await more.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).borderTopWidth),
      );
      expect(bottom + top).toBe(1);
    }
  }
});

test("a missing GitHub issue-type catalog retains the current native name and color without offering an unavailable choice", async ({
  page,
}) => {
  const id = await session(page);
  const issue = await fixtureTool<{ updatedAt: string }>(
    page,
    id,
    "arco_get_issue",
    { repo: "yu/Arco", number: 42 },
  );
  await fixtureTool(page, id, "arco_issue_attributes", {
    repo: "yu/Arco",
    number: 42,
    expectedUpdatedAt: issue.updatedAt,
    patch: { issueTypeId: 1 },
    requestId: crypto.randomUUID(),
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_issue_catalog") return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    return route.fulfill({
      response,
      json: {
        ...result,
        structuredContent: {
          ...result.structuredContent,
          issueTypes: [],
          errors: ["Issue type choices are unavailable."],
        },
      },
    });
  });
  await open(page, "github", id);
  const ui = app(page);
  const nativeBlue = await selectControl(ui, "Arco implementation status")
    .locator(".property-label-dot")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await ui.getByText("More properties", { exact: true }).click();
  await ui.getByText("Edit attributes and membership", { exact: true }).click();
  const type = selectControl(ui, "Change issue type");
  await expect(type.getByRole("button")).toHaveText("Task");
  await expect(type.locator(".property-label-dot")).toHaveCSS(
    "background-color",
    nativeBlue,
  );
  await expect(
    ui.getByText("Issue type choices are unavailable.", { exact: true }),
  ).toBeVisible();
  await type.getByRole("button").click();
  const current = ui.getByRole("option", { name: "Task", exact: true });
  await expect(current).toHaveAttribute("aria-disabled", "true");
  await expect(current.locator(".property-label-dot")).toHaveCSS(
    "background-color",
    nativeBlue,
  );
});
