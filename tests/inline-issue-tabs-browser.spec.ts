import { expect, test, type Page } from "@playwright/test";
import {
  MAX_PRESENTED_ISSUES,
  type NativeIssueTarget,
} from "../src/shared/launch";
import type { ConversationIssue } from "../src/shared/contracts";
import { choose, selectControl } from "./select-helpers";
import { expectDraftWrite, observeDraftWrites } from "./draft-helpers";
import { latestSharedSelection } from "./shared-context-helpers";
import { toolFailure } from "./tool-failure";

const app = (page: Page) => page.frameLocator("#arco");
const github = (number: number): NativeIssueTarget => ({
  source: "github",
  repo: "yu/Arco",
  number,
});
const linear = (number: number): NativeIssueTarget => ({
  source: "linear",
  connectionId: "default",
  workspaceId: "fixture-linear-workspace",
  teamId: "fixture-linear-team",
  issueId: `fixture-linear-${number}`,
});
const titles = {
  github42: "Preserve issue selection and scroll position",
  github43: "Separate shared context from sending a request",
  linear42: "Keep Linear workflow states intact",
  linear43: "Share a Linear issue with the Codex chat",
};
type ToolCall = { name: string; arguments: Record<string, unknown> };
async function events<T>(page: Page, type: string): Promise<T[]> {
  const log = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  ) as { type: string; value: T }[];
  return log.filter((event) => event.type === type).map((event) => event.value);
}
const tabs = (page: Page) =>
  app(page).getByRole("tablist", { name: "Issues", exact: true });
const issueTab = (page: Page, identifier: string) =>
  tabs(page).getByRole("tab", { name: new RegExp(`^${identifier} `) });
const panel = (page: Page) => app(page).getByRole("tabpanel");
async function expectTitle(page: Page, title: string) {
  await expect(
    app(page).getByRole("heading", { name: title, exact: true, level: 1 }),
  ).toBeVisible();
}
async function open(page: Page, targets?: NativeIssueTarget[]) {
  const query = new URLSearchParams({ entry: "issues" });
  if (targets) query.set("targets", JSON.stringify(targets));
  await page.goto(`/?${query}`);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await expect(
    app(page).getByRole("region", { name: "Issues", exact: true }),
  ).toBeVisible();
  await expect(tabs(page)).toBeVisible();
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page).getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
}
async function selectIssue(page: Page, identifier: string, title: string) {
  const tab = issueTab(page, identifier);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expectTitle(page, title);
}
async function openDetails(page: Page, title: string) {
  await panel(page)
    .getByRole("button", { name: "Open details", exact: true })
    .click();
  await expect(app(page).locator(".workspace")).toBeVisible();
  await expectTitle(page, title);
}
async function backToTabs(page: Page) {
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(tabs(page)).toBeVisible();
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page).getByRole("heading", { level: 1 })).toBeVisible();
}
async function expectNoSharing(page: Page) {
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
}
async function addSelection(page: Page) {
  await app(page)
    .getByRole("toolbar", { name: "Text selection", exact: true })
    .getByRole("button", { name: "Add to chat", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  return latestSharedSelection((await events(page, "context"))[0]);
}

test(
  "grouped issues reuse every loaded detail and prefetch leading images without duplicate reads",
  { tag: "@smoke" },
  async ({ page }) => {
    const requests: ToolCall[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/tool")
        requests.push(request.postDataJSON() as ToolCall);
    });
    await open(page, [github(42), github(43), linear(42), linear(43)]);
    await expect(tabs(page).getByRole("tab")).toHaveCount(MAX_PRESENTED_ISSUES);
    await expect(issueTab(page, "yu/Arco #42")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel(page)).toContainText(
      "Return to the same position when switching between issues.",
    );
    await expect(
      panel(page).getByRole("heading", { name: titles.github43, exact: true }),
    ).toHaveCount(0);
    await expect(
      panel(page).getByRole("heading", { name: titles.linear42, exact: true }),
    ).toHaveCount(0);
    expect(await events(page, "display")).toEqual(["inline"]);
    expect(await events(page, "display-request")).toEqual([]);
    expect(
      requests.filter((request) => request.name === "arco_show_issues"),
    ).toHaveLength(1);
    await expect
      .poll(() =>
        requests.filter(
          (request) =>
            request.name === "linear_read_image" &&
            request.arguments.issueId === "fixture-linear-42",
        ),
      )
      .toHaveLength(1);
    await selectIssue(page, "yu/Arco #43", titles.github43);
    await expect(panel(page)).toContainText(
      "Selecting an issue never sends a message.",
    );
    await selectIssue(page, "YU-42", titles.linear42);
    await expect(
      selectControl(panel(page), "Linear Workflow state"),
    ).toHaveAttribute("data-value", "linear-state-progress");
    await expect(
      panel(page).getByRole("img", {
        name: "Fixture illustration",
        exact: true,
      }),
    ).toBeVisible();
    await selectIssue(page, "YU-43", titles.linear43);
    await expect(
      selectControl(panel(page), "Linear Workflow state"),
    ).toHaveAttribute("data-value", "linear-state-todo");
    await selectIssue(page, "yu/Arco #42", titles.github42);
    expect(
      requests.filter((request) => request.name === "arco_show_issues"),
    ).toHaveLength(1);
    expect(
      requests.filter((request) =>
        [
          "linear_get_issue",
          "arco_get_issue",
          "arco_comments",
          "linear_comments",
        ].includes(request.name),
      ),
    ).toEqual([]);
    expect(
      requests.filter((request) =>
        /(?:update|create|delete|comment$)/.test(request.name),
      ),
    ).toEqual([]);
    expect(
      requests.filter(
        (request) =>
          request.name === "linear_read_image" &&
          request.arguments.issueId === "fixture-linear-42",
      ),
    ).toHaveLength(1);
    await expectNoSharing(page);
  },
);

test("failed image prefetch leaves issue bodies, states, and other tabs usable", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolCall;
    if (["arco_read_image", "linear_read_image"].includes(input.name))
      return route.fulfill({
        status: 200,
        json: toolFailure("Fixture image preview could not be loaded"),
      });
    return route.fallback();
  });
  await open(page, [github(42), github(43), linear(42)]);
  await expect(panel(page)).toContainText(
    "Return to the same position when switching between issues.",
  );
  await expect(
    selectControl(panel(page), "Change issue state"),
  ).toHaveAttribute("data-value", "open");
  await expect(
    panel(page).getByText("Image preview unavailable."),
  ).toBeVisible();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  await selectIssue(page, "YU-42", titles.linear42);
  await expect(panel(page)).toContainText("Use native Linear states");
  await expect(
    selectControl(panel(page), "Linear Workflow state"),
  ).toHaveAttribute("data-value", "linear-state-progress");
  await expect(
    panel(page).getByText("Image preview unavailable."),
  ).toBeVisible();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  await selectIssue(page, "yu/Arco #43", titles.github43);
  await expect(panel(page)).toContainText(
    "Selecting an issue never sends a message.",
  );
  await expect(
    selectControl(panel(page), "Change issue state"),
  ).toHaveAttribute("data-value", "open");
  await expect(panel(page).getByText("Image preview unavailable.")).toHaveCount(
    0,
  );
  await selectIssue(page, "yu/Arco #42", titles.github42);
  await expect(
    panel(page).getByText("Image preview unavailable."),
  ).toBeVisible();
  await expectNoSharing(page);
});

test("mixed-provider tabs keep selection inline and open exact native details", async ({
  page,
}) => {
  await open(page, [github(43), linear(42)]);
  await expect(issueTab(page, "YU-42")).toHaveAccessibleDescription(
    "In Progress",
  );
  await selectIssue(page, "YU-42", titles.linear42);
  expect(await events(page, "display-request")).toEqual([]);
  await expect(
    selectControl(panel(page), "Linear Workflow state"),
  ).toBeVisible();
  await openDetails(page, titles.linear42);
  await backToTabs(page);
  await expect(issueTab(page, "YU-42")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await selectIssue(page, "yu/Arco #43", titles.github43);
  await openDetails(page, titles.github43);
  const calls = await events<ToolCall>(page, "tool");
  expect(
    calls.filter(
      (call) =>
        call.name === "linear_get_issue" &&
        call.arguments.issueId === "fixture-linear-42",
    ),
  ).toEqual([]);
  expect(
    calls.filter(
      (call) =>
        call.name === "arco_get_issue" &&
        call.arguments.repo === "yu/Arco" &&
        call.arguments.number === 43,
    ),
  ).toEqual([]);
  expect(
    calls.filter((call) => /(?:update|create|delete|comment$)/.test(call.name)),
  ).toEqual([]);
  await backToTabs(page);
  await expect(issueTab(page, "yu/Arco #43")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await selectIssue(page, "YU-42", titles.linear42);
  await openDetails(page, titles.linear42);
  expect(
    (await events<ToolCall>(page, "tool")).filter(
      (call) =>
        call.name === "arco_update_settings" ||
        /(?:update|create|delete|comment$)/.test(call.name),
    ),
  ).toEqual([]);
  await expectNoSharing(page);
});

test("same-provider tabs open the selected issue after returning from another detail", async ({
  page,
}) => {
  await open(page);
  for (const [number, title] of [
    [43, titles.github43],
    [42, titles.github42],
  ] as const) {
    await selectIssue(page, `yu/Arco #${number}`, title);
    await openDetails(page, title);
    await backToTabs(page);
    await expect(issueTab(page, `yu/Arco #${number}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  const reads = (await events<ToolCall>(page, "tool")).filter(
    (call) => call.name === "arco_get_issue",
  );
  expect(reads).toEqual([]);
  await expectNoSharing(page);
});

test("native quick state changes refresh only the selected tab summary", async ({
  page,
}) => {
  await open(page);
  await selectIssue(page, "yu/Arco #43", titles.github43);
  await choose(panel(page), "Change issue state", "completed");
  await expect(
    selectControl(panel(page), "Change issue state"),
  ).toHaveAttribute("data-value", "completed");
  await expect(issueTab(page, "yu/Arco #43")).toHaveAccessibleDescription(
    "Closed · Completed",
  );
  expect(
    JSON.parse(
      (await issueTab(page, "yu/Arco #43").getAttribute("data-arco-issue"))!,
    ),
  ).toMatchObject({ source: "github", number: 43, state: "closed" });
  await expect(issueTab(page, "yu/Arco #42")).toHaveAccessibleDescription(
    "Open",
  );
  await selectIssue(page, "yu/Arco #42", titles.github42);
  await expect(
    selectControl(panel(page), "Change issue state"),
  ).toHaveAttribute("data-value", "open");
  const writes = (await events<ToolCall>(page, "tool")).filter(
    (call) => call.name === "arco_update_issue",
  );
  expect(writes.map((call) => call.arguments.patch)).toEqual([
    { state: "closed", stateReason: "completed" },
  ]);
  expect(writes[0].arguments).toMatchObject({ repo: "yu/Arco", number: 43 });
  await expectNoSharing(page);
});

test("native Linear workflow changes refresh their tab without changing GitHub state", async ({
  page,
}) => {
  await open(page, [github(42), linear(42)]);
  await selectIssue(page, "YU-42", titles.linear42);
  await choose(panel(page), "Linear Workflow state", "linear-state-done");
  await expect(
    selectControl(panel(page), "Linear Workflow state"),
  ).toHaveAttribute("data-value", "linear-state-done");
  await expect(issueTab(page, "YU-42")).toHaveAccessibleDescription("Done");
  expect(
    JSON.parse(
      (await issueTab(page, "YU-42").getAttribute("data-arco-issue"))!,
    ),
  ).toMatchObject({
    source: "linear",
    id: "fixture-linear-42",
    state: { id: "linear-state-done", name: "Done" },
  });
  await expect(issueTab(page, "yu/Arco #42")).toHaveAccessibleDescription(
    "Open",
  );
  await selectIssue(page, "yu/Arco #42", titles.github42);
  await expect(
    selectControl(panel(page), "Change issue state"),
  ).toHaveAttribute("data-value", "open");
  const writes = (await events<ToolCall>(page, "tool")).filter((call) =>
    ["arco_update_issue", "linear_update_issue"].includes(call.name),
  );
  expect(writes.map((call) => call.arguments.patch)).toEqual([
    { stateId: "linear-state-done" },
  ]);
  expect(writes[0]).toMatchObject({
    name: "linear_update_issue",
    arguments: {
      connectionId: "default",
      workspaceId: "fixture-linear-workspace",
      teamId: "fixture-linear-team",
      issueId: "fixture-linear-42",
    },
  });
  await expectNoSharing(page);
});

test("small tab pills fit 375 px and use roving keyboard focus without opening details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await open(page, [github(42), github(43), linear(42)]);
  const layout = await tabs(page).evaluate((element) => ({
    width: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
    tabs: [...element.querySelectorAll('[role="tab"]')].map((tab) => {
      const bounds = tab.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, height: bounds.height };
    }),
  }));
  expect(layout.contentWidth).toBeLessThanOrEqual(layout.width + 1);
  for (const tab of layout.tabs) {
    expect(tab.left).toBeGreaterThanOrEqual(0);
    expect(tab.right).toBeLessThanOrEqual(layout.width + 1);
    expect(tab.height).toBeLessThanOrEqual(28);
  }
  const first = issueTab(page, "yu/Arco #42");
  const second = issueTab(page, "yu/Arco #43");
  const last = issueTab(page, "YU-42");
  await first.focus();
  await first.press("ArrowRight");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(second).toHaveAttribute("tabindex", "0");
  await expect(first).toHaveAttribute("tabindex", "-1");
  await second.press("End");
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await last.press("Home");
  await expect(first).toBeFocused();
  await first.press("ArrowLeft");
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expectTitle(page, titles.linear42);
  expect(await events(page, "display-request")).toEqual([]);
  await expectNoSharing(page);
});

test("a denied fullscreen request keeps the current tabs and native card available", async ({
  page,
}) => {
  await open(page);
  await selectIssue(page, "yu/Arco #43", titles.github43);
  await page
    .getByRole("checkbox", { name: "Mock keep current display mode" })
    .check();
  await panel(page)
    .getByRole("button", { name: "Open details", exact: true })
    .click();
  await expect(tabs(page)).toBeVisible();
  await expect(issueTab(page, "yu/Arco #43")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    panel(page).getByText("Could not open issue details. Try again.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(await events(page, "display-request")).toEqual([
    { requested: "fullscreen", actual: "inline" },
  ]);
  await expectNoSharing(page);
});

for (const source of ["github", "linear"] as const) {
  test(`${source} keeps failed local drafts through tabs and detail reopening`, async ({
    page,
  }) => {
    observeDraftWrites(page);
    let allowDraftWrites = false;
    const failure = "Fixture local draft storage is unavailable";
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as ToolCall;
      if (input.name === "arco_write_draft" && !allowDraftWrites)
        return route.fulfill({ status: 200, json: toolFailure(failure) });
      return route.fallback();
    });
    await open(page, [github(42), linear(42)]);
    const ui = app(page);
    const identifier = source === "github" ? "yu/Arco #42" : "YU-42";
    const sourceTitle = source === "github" ? titles.github42 : titles.linear42;
    const draftTitle = `${source} title kept after a failed local save`;
    const draftBody = `${source} body kept after a failed local save`;
    const titleInput = ui.getByRole("textbox", {
      name: source === "github" ? "Issue title" : "Linear title",
      exact: true,
    });
    const bodyInput = ui.getByRole("textbox", {
      name: source === "github" ? "Issue body" : "Linear Markdown description",
      exact: true,
    });
    const openEditor = async () => {
      if (await titleInput.isVisible()) return;
      await ui.getByLabel("Issue actions", { exact: true }).click();
      await ui
        .getByRole("button", {
          name: source === "github" ? "Edit issue" : "Edit Linear description",
          exact: true,
        })
        .click();
    };
    await selectIssue(page, identifier, sourceTitle);
    await openDetails(page, sourceTitle);
    await openEditor();
    await titleInput.fill(draftTitle);
    await bodyInput.fill(draftBody);
    const retry = ui.getByRole("button", {
      name: "Retry saving draft",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await expect(
      ui.getByRole("alert").filter({ hasText: failure }),
    ).toBeVisible();
    await backToTabs(page);
    await expect(issueTab(page, identifier)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await selectIssue(
      page,
      source === "github" ? "YU-42" : "yu/Arco #42",
      source === "github" ? titles.linear42 : titles.github42,
    );
    await selectIssue(page, identifier, sourceTitle);
    await openDetails(page, sourceTitle);
    await expect(retry).toBeVisible();
    await expect(
      ui.getByRole("alert").filter({ hasText: failure }),
    ).toBeVisible();
    await openEditor();
    await expect(titleInput).toHaveValue(draftTitle);
    await expect(bodyInput).toHaveValue(draftBody);
    allowDraftWrites = true;
    await retry.click();
    await expectDraftWrite(page, { title: draftTitle, body: draftBody });
    await expect(retry).toHaveCount(0);
    const calls = await events<ToolCall>(page, "tool");
    expect(
      calls.filter((call) =>
        ["arco_update_issue", "linear_update_issue"].includes(call.name),
      ),
    ).toEqual([]);
    await expectNoSharing(page);
  });

  test(`selecting one ${source} tab shares its native issue reference`, async ({
    page,
  }) => {
    await open(page, [github(42), linear(42)]);
    const tab = issueTab(page, source === "github" ? "yu/Arco #42" : "YU-42");
    const text = await tab.evaluate(async (element) => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return selection.toString();
    });
    const context = await addSelection(page);
    expect(context).toMatchObject({
      source,
      ...(source === "github"
        ? { repo: "yu/Arco", number: 42, id: "fixture-issue-42" }
        : {
            connectionId: "default",
            workspaceId: "fixture-linear-workspace",
            teamId: "fixture-linear-team",
            id: "fixture-linear-42",
            identifier: "YU-42",
          }),
      selection: { text, origin: "ui" },
    });
    expect(context).not.toHaveProperty("body");
    expect(await events(page, "message")).toEqual([]);
  });
}

test("text selected across tabs has no arbitrary issue reference", async ({
  page,
}) => {
  await open(page, [github(42), linear(42)]);
  const text = await tabs(page).evaluate(async (tablist) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const items = tablist.querySelectorAll('[role="tab"]');
    const range = document.createRange();
    range.setStart(items[0], 0);
    range.setEnd(items[1], items[1].childNodes.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    tablist.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return selection.toString();
  });
  expect(text).toContain("#42");
  expect(text).toContain("YU-42");
  const context = await addSelection(page);
  expect(context).toEqual({
    source: "arco",
    selection: { text, origin: "ui" },
  });
  expect(await events(page, "message")).toEqual([]);
});

test("description reading positions stay separate across same and mixed provider tabs without expansion", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolCall;
    if (
      !["arco_show_issues", "arco_get_issue", "linear_get_issue"].includes(
        input.name,
      )
    )
      return route.fallback();
    const response = await route.fetch();
    const result = (await response.json()) as {
      structuredContent: ConversationIssue;
      _meta?: { issueDetails?: ConversationIssue[] };
    };
    const details =
      input.name === "arco_show_issues"
        ? (result._meta?.issueDetails ?? [])
        : [result.structuredContent];
    for (const issue of details) {
      const paragraphs =
        issue.source === "linear" ? 50 : issue.number === 43 ? 40 : 30;
      issue.body = [
        "## Reading position fixture",
        ...Array.from(
          { length: paragraphs },
          (_, index) =>
            `Paragraph ${index + 1}. Keep this issue's reading position when switching tabs.`,
        ),
        "End of the complete description.",
      ].join("\n\n");
    }
    return route.fulfill({ response, json: result });
  });
  await open(page, [github(42), github(43), linear(42)]);
  const targets = [
    ["yu/Arco #42", titles.github42],
    ["yu/Arco #43", titles.github43],
    ["YU-42", titles.linear42],
  ] as const;
  const positions = new Map<string, number>();
  for (const [identifier, title] of targets) {
    await selectIssue(page, identifier, title);
    const description = panel(page).getByRole("region", {
      name: "Issue description text",
      exact: true,
    });
    await expect(description).toContainText("End of the complete description.");
    await expect(description).toHaveCSS("overflow-y", "auto");
    await expect(
      panel(page).getByRole("button", {
        name: /(?:Expand|Collapse) description/,
      }),
    ).toHaveCount(0);
    expect(await description.evaluate((element) => element.scrollTop)).toBe(0);
    await description.press("End");
    await expect
      .poll(() =>
        description.evaluate(
          (element) =>
            element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThanOrEqual(1);
    const position = await description.evaluate((element) => element.scrollTop);
    expect(position).toBeGreaterThan(0);
    positions.set(identifier, position);
  }
  expect(new Set(positions.values()).size).toBe(targets.length);
  for (const [identifier, title] of targets) {
    await selectIssue(page, identifier, title);
    await expect
      .poll(() =>
        panel(page)
          .getByRole("region", { name: "Issue description text", exact: true })
          .evaluate((element) => element.scrollTop),
      )
      .toBeCloseTo(positions.get(identifier)!, 0);
  }
  await selectIssue(page, "yu/Arco #42", titles.github42);
  await panel(page)
    .getByRole("region", { name: "Issue description text", exact: true })
    .press("Home");
  await expect
    .poll(() =>
      panel(page)
        .getByRole("region", { name: "Issue description text", exact: true })
        .evaluate((element) => element.scrollTop),
    )
    .toBe(0);
  await selectIssue(page, "YU-42", titles.linear42);
  await expect
    .poll(() =>
      panel(page)
        .getByRole("region", { name: "Issue description text", exact: true })
        .evaluate((element) => element.scrollTop),
    )
    .toBeCloseTo(positions.get("YU-42")!, 0);
  await selectIssue(page, "yu/Arco #42", titles.github42);
  expect(
    await panel(page)
      .getByRole("region", { name: "Issue description text", exact: true })
      .evaluate((element) => element.scrollTop),
  ).toBe(0);
  expect(
    (await events<ToolCall>(page, "tool")).filter((call) =>
      /(?:update|create|delete|comment$)/.test(call.name),
    ),
  ).toEqual([]);
  expect(await events(page, "display-request")).toEqual([]);
  await expectNoSharing(page);
});
