import { expect, test, type Page } from "./browser-test";
import type { Settings, SettingsRecord } from "../src/shared/state";
import type {
  SymphonyConnection,
  SymphonySnapshot,
} from "../src/shared/symphony";
import { choose, selectControl } from "./select-helpers";
import { toolFailure } from "./tool-failure";

const app = (page: Page) => page.frameLocator("#arco");
const githubTitle = "Preserve issue selection and scroll position";
const linearTitle = "Keep Linear workflow states intact";
const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

const githubConnection: SymphonyConnection = {
  id: "fixture-symphony-github",
  name: "Arco GitHub",
  baseUrl: "http://127.0.0.1:4318",
  binding: {
    source: "github",
    repo: "yu/Arco",
    prepareLabels: ["design"],
    reviewLabels: ["enhancement"],
  },
};
const linearConnection: SymphonyConnection = {
  id: "fixture-symphony-linear",
  name: "Arco Linear",
  baseUrl: "http://127.0.0.1:4319",
  binding: {
    source: "linear",
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-linear-team",
    prepareStateIds: ["linear-state-todo"],
    reviewStateIds: ["linear-state-done"],
  },
};

async function tool<T>(
  page: Page,
  session: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
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

async function sessionWithSettings(page: Page, patch: Partial<Settings> = {}) {
  const response = await page.request.post("/session");
  expect(response.ok()).toBe(true);
  const { session } = (await response.json()) as { session: string };
  const current = await tool<SettingsRecord>(
    page,
    session,
    "arco_get_settings",
  );
  await tool(page, session, "arco_update_settings", {
    expectedRevision: current.revision,
    patch: {
      activeSource: "symphony",
      symphonyConnections: [githubConnection, linearConnection],
      activeSymphonyConnectionId: githubConnection.id,
      symphonyLayout: "board",
      ...patch,
    },
  });
  return session;
}

async function events(page: Page, type: string) {
  const values = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  ) as { type: string; value: unknown }[];
  return values
    .filter((event) => event.type === type)
    .map((event) => event.value);
}

async function open(page: Page, session: string, query = "&source=symphony") {
  await page.goto(`/?session=${session}${query}`);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await expect(
    app(page).getByRole("main", { name: "Symphony workspace" }),
  ).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
}

function work(page: Page, identifier: string) {
  return app(page).getByRole("button", {
    name: new RegExp(`^${identifier}:`),
  });
}

test("Symphony uses the flat source menu and shares only on request across board and table @smoke", async ({
  page,
}) => {
  const session = await sessionWithSettings(page);
  await open(page, session);
  const ui = app(page);
  const picker = selectControl(ui, "Issue source");
  await picker.getByRole("button").click();
  await expect(ui.getByRole("option")).toHaveCount(3);
  for (const name of ["GitHub", "Linear", "Symphony"])
    await expect(ui.getByRole("option", { name, exact: true })).toBeVisible();
  await expect(ui.getByRole("tab")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await expect(work(page, "GH-42")).toContainText(githubTitle);
  await work(page, "GH-42").click();
  const detail = ui.getByRole("complementary", {
    name: "Symphony work details",
  });
  await expect(
    detail.getByRole("heading", { name: "Runtime", exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("heading", { name: "Issue context", exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
  const search = ui.getByRole("searchbox", { name: "Search Symphony work" });
  await search.fill("Preserve");
  await expect(work(page, "GH-43")).toHaveCount(0);
  await ui.getByRole("button", { name: "Table view", exact: true }).click();
  await expect(work(page, "GH-42")).toHaveAttribute("aria-pressed", "true");
  await expect(search).toHaveValue("Preserve");
  await expect(
    detail.getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
  await ui.getByRole("button", { name: "Board view", exact: true }).click();
  await expect(work(page, "GH-42")).toHaveAttribute("aria-pressed", "true");
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);

  await detail
    .getByRole("button", {
      name: "Add run context to chat",
      exact: true,
    })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const shared = JSON.stringify(await events(page, "context"));
  expect(shared).toContain("GH-42");
  expect(shared).toContain("running");
  expect(shared).toContain("observedAt");
  expect(shared).not.toContain("workspacePath");
  expect(shared).not.toContain("workerHost");
  expect(await events(page, "message")).toEqual([]);
});

for (const explicit of [true, false]) {
  test(`Symphony ${explicit ? "explicit launch" : "saved view"} opens without tracker sign-in`, async ({
    page,
  }) => {
    const reads: string[] = [];
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      if (
        input.name === "arco_connection" ||
        input.name.startsWith("linear_") ||
        input.name === "arco_account_issues" ||
        input.name === "arco_list_issues"
      ) {
        reads.push(input.name);
        return route.fulfill({
          json: toolFailure("Tracker is disconnected.", "auth"),
        });
      }
      return route.continue();
    });
    const runtimeOnly = { ...githubConnection, binding: undefined };
    const session = await sessionWithSettings(page, {
      symphonyConnections: [runtimeOnly],
    });
    await open(page, session, explicit ? "&source=symphony" : "");
    await expect(work(page, "GH-42")).toBeVisible();
    await work(page, "GH-42").click();
    await expect(
      app(page).getByRole("heading", { name: "Runtime", exact: true }),
    ).toBeVisible();
    expect(reads).toEqual([]);
    expect(await events(page, "context")).toEqual([]);
  });
}

for (const source of ["github", "linear"] as const) {
  test(`${source} places runtime below native properties and retains an unsent body through View run`, async ({
    page,
  }) => {
    const session = await sessionWithSettings(page, { activeSource: source });
    await page.goto(
      `/?session=${session}&entry=detail&source=${source}&number=42`,
    );
    const ui = app(page);
    const title = source === "github" ? githubTitle : linearTitle;
    await expect(
      ui.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const attributes = ui.locator(".issue-properties");
    await expect(
      attributes.getByText("Symphony run", { exact: true }),
    ).toBeVisible();
    expect(
      await attributes.evaluate((element) => {
        const advanced = element.querySelector(".property-advanced");
        const heading = Array.from(element.querySelectorAll("*")).find(
          (node) => node.textContent === "Symphony run",
        );
        return (
          !!advanced &&
          !!heading &&
          !advanced.contains(heading) &&
          !!(
            advanced.compareDocumentPosition(heading) &
            Node.DOCUMENT_POSITION_FOLLOWING
          )
        );
      }),
    ).toBe(true);
    await expect(ui.locator(".issue-main")).not.toContainText("Symphony run");
    await expect(ui.locator(".detail-toolbar")).not.toContainText("Symphony");

    const editBody = async () => {
      const field = ui.getByRole("textbox", {
        name:
          source === "github" ? "Issue body" : "Linear Markdown description",
        exact: true,
      });
      if (!(await field.count())) {
        await ui.locator('summary[aria-label="Issue actions"]').click();
        await ui
          .getByRole("button", {
            name:
              source === "github" ? "Edit issue" : "Edit Linear description",
            exact: true,
          })
          .click();
      }
      return field;
    };
    const body = await editBody();
    await body.fill(
      `Unsent ${source} requirements survive Symphony navigation.`,
    );
    await attributes
      .getByRole("button", { name: "View run", exact: true })
      .click();
    await expect(
      ui.getByRole("main", { name: "Symphony workspace" }),
    ).toBeVisible();
    const detail = ui.getByRole("complementary", {
      name: "Symphony work details",
    });
    await expect(
      detail.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await detail
      .getByRole("button", { name: "Open issue", exact: true })
      .click();
    await expect(
      ui.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(await editBody()).toHaveValue(
      `Unsent ${source} requirements survive Symphony navigation.`,
    );
    expect(await events(page, "context")).toEqual([]);
    expect(await events(page, "message")).toEqual([]);
  });
}

for (const narrow of [false, true]) {
  test(`a failed runtime refresh keeps the last snapshot and disappearance never means completion${narrow ? " in narrow details @smoke" : ""}`, async ({
    page,
  }) => {
    if (narrow) await page.setViewportSize({ width: 540, height: 1000 });
    let state: "online" | "offline" | "empty" = "online";
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      if (input.name !== "arco_symphony_state") return route.continue();
      if (state === "offline")
        return route.fulfill({
          json: toolFailure("Symphony could not be reached."),
        });
      const response = await route.fetch();
      if (state !== "empty") return route.fulfill({ response });
      const result = (await response.json()) as {
        structuredContent: SymphonySnapshot;
      };
      result.structuredContent.rows = [];
      return route.fulfill({ response, json: result });
    });
    const runtimeOnly = { ...githubConnection, binding: undefined };
    const session = await sessionWithSettings(page, {
      symphonyConnections: [runtimeOnly],
    });
    await open(page, session);
    await work(page, "GH-42").click();
    state = "offline";
    await app(page)
      .getByRole("button", { name: "Refresh Symphony", exact: true })
      .click();
    await expect(
      app(page)
        .getByRole("alert")
        .filter({ hasText: "Symphony could not be reached." }),
    ).toBeVisible();
    await expect(
      app(page).getByText("Last observed work is retained.", { exact: false }),
    ).toBeVisible();
    if (narrow) await expect(work(page, "GH-42")).toBeHidden();
    else await expect(work(page, "GH-42")).toBeVisible();
    await expect(
      app(page).getByRole("complementary", { name: "Symphony work details" }),
    ).toContainText("Running");
    state = "online";
    await app(page)
      .getByRole("button", { name: "Refresh Symphony", exact: true })
      .click();
    await expect(
      app(page)
        .getByRole("alert")
        .filter({ hasText: "Symphony could not be reached." }),
    ).toHaveCount(0);
    await expect(
      app(page).getByRole("complementary", { name: "Symphony work details" }),
    ).toContainText("Running");
    state = "empty";
    await app(page)
      .getByRole("button", { name: "Refresh Symphony", exact: true })
      .click();
    await expect(
      app(page).getByText("This work is no longer in the current snapshot.", {
        exact: true,
      }),
    ).toBeVisible();
    const detail = app(page).getByRole("complementary", {
      name: "Symphony work details",
    });
    await expect(detail).not.toContainText("Completed");
    await expect(
      detail.getByRole("button", { name: "Add run context to chat" }),
    ).toHaveCount(0);
  });
}

test("connection setup validates URLs, tests the API, and saves edits without issue writes", async ({
  page,
}) => {
  const session = await sessionWithSettings(page);
  await open(page, session);
  const ui = app(page);
  await ui
    .getByRole("button", { name: "Add Symphony connection", exact: true })
    .click();
  let editor = ui.getByRole("dialog", {
    name: "Add Symphony connection",
    exact: true,
  });
  await editor
    .getByRole("textbox", { name: "Connection name", exact: true })
    .fill("Private devbox");
  const url = editor.getByRole("textbox", {
    name: "Symphony URL",
    exact: true,
  });
  await url.fill("http://remote.example.test");
  await editor
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(editor).toContainText(/local HTTP or remote HTTPS/);
  await url.fill("https://symphony-fixture.invalid/github");
  await editor
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    editor.getByText("Connection verified", { exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  let saved = await tool<SettingsRecord>(page, session, "arco_get_settings");
  const added = saved.settings.symphonyConnections.find(
    (item) => item.name === "Private devbox",
  );
  expect(added?.baseUrl).toBe("https://symphony-fixture.invalid/github");
  expect(added?.binding).toBeUndefined();
  await expect(selectControl(ui, "Symphony connection")).toContainText(
    "Private devbox",
  );

  await ui
    .getByRole("button", { name: "Edit Symphony connection", exact: true })
    .click();
  editor = ui.getByRole("dialog", {
    name: "Edit Symphony connection",
    exact: true,
  });
  await editor
    .getByRole("textbox", { name: "Connection name", exact: true })
    .fill("Renamed devbox");
  await editor
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  saved = await tool<SettingsRecord>(page, session, "arco_get_settings");
  expect(
    saved.settings.symphonyConnections.find((item) => item.id === added?.id)
      ?.name,
  ).toBe("Renamed devbox");
  await ui
    .getByRole("button", { name: "Edit Symphony connection", exact: true })
    .click();
  editor = ui.getByRole("dialog", {
    name: "Edit Symphony connection",
    exact: true,
  });
  await editor
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await expect(
    editor.getByRole("group", { name: "Remove this connection?", exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Remove connection", exact: true })
    .last()
    .click();
  await expect(editor).toHaveCount(0);
  saved = await tool<SettingsRecord>(page, session, "arco_get_settings");
  expect(
    saved.settings.symphonyConnections.some((item) => item.id === added?.id),
  ).toBe(false);
  const writes = JSON.stringify(await events(page, "tool"));
  expect(writes).not.toContain('"name":"arco_update_issue"');
  expect(writes).not.toContain('"name":"linear_update_issue"');
  expect(await events(page, "context")).toEqual([]);
});

test("changing the Symphony connection keeps each tracker scope separate", async ({
  page,
}) => {
  const session = await sessionWithSettings(page);
  await open(page, session);
  const ui = app(page);
  await expect(work(page, "GH-42")).toContainText(githubTitle);
  await work(page, "GH-42").click();
  await choose(ui, "Symphony connection", linearConnection.id);
  await expect(work(page, "GH-42")).toHaveCount(0);
  await expect(work(page, "YU-42")).toContainText(linearTitle);
  await work(page, "YU-42").click();
  const detail = ui.getByRole("complementary", {
    name: "Symphony work details",
  });
  await expect(detail).toContainText("Blocked");
  await expect(
    detail.getByRole("heading", { name: linearTitle, exact: true }),
  ).toBeVisible();
  await expect(detail).not.toContainText(githubTitle);
  await choose(ui, "Symphony connection", githubConnection.id);
  await expect(work(page, "GH-42")).toContainText(githubTitle);
  await expect(work(page, "YU-42")).toHaveCount(0);
  expect(await events(page, "context")).toEqual([]);
});

test("narrow Symphony details are keyboard reachable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 540, height: 1000 });
  const session = await sessionWithSettings(page);
  await open(page, session);
  const ui = app(page);
  await expect(work(page, "GH-42")).toContainText(githubTitle);
  await work(page, "GH-42").focus();
  await page.keyboard.press("Enter");
  const detail = ui.getByRole("complementary", {
    name: "Symphony work details",
  });
  await expect(detail).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Add run context to chat" }),
  ).toBeVisible();
  expect(
    await ui
      .locator("body")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await detail
    .getByRole("button", { name: "Close work details", exact: true })
    .click();
  await expect(work(page, "GH-42")).toBeVisible();
  await ui.getByRole("button", { name: "Table view", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    ui.getByRole("button", { name: "Table view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await events(page, "message")).toEqual([]);
});

test("runtime polling pauses while the Symphony surface is hidden", async ({
  page,
}) => {
  await page.clock.install();
  let reads = 0;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "arco_symphony_state") reads++;
    return route.continue();
  });
  const session = await sessionWithSettings(page, {
    symphonyConnections: [{ ...githubConnection, binding: undefined }],
  });
  await open(page, session);
  await expect(work(page, "GH-42")).toBeVisible();
  const initialReads = reads;
  await page.clock.fastForward(5_100);
  await expect.poll(() => reads).toBeGreaterThan(initialReads);
  await expect(
    app(page).getByRole("button", { name: "Refresh Symphony", exact: true }),
  ).toBeEnabled();
  await app(page)
    .locator("body")
    .evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  const hiddenReads = reads;
  await page.clock.fastForward(16_000);
  expect(reads).toBe(hiddenReads);
  await app(page)
    .locator("body")
    .evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  await page.clock.fastForward(5_100);
  await expect.poll(() => reads).toBeGreaterThan(hiddenReads);
});
