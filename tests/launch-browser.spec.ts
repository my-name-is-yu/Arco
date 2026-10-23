import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { Settings, SettingsRecord } from "../src/shared/state";
import { choose, selectControl } from "./select-helpers";

const firstTitle = "Preserve issue selection and scroll position";
const mentionedTitle = "Separate shared context from sending a request";
const projectKey = "1".repeat(64);
const otherProjectKey = "2".repeat(64);
const app = (page: Page) => page.frameLocator("#arco");
const errors = new WeakMap<BrowserContext, string[]>();

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
  if (Object.keys(patch).length) {
    const current = await tool<SettingsRecord>(
      page,
      session,
      "arco_get_settings",
    );
    await tool(page, session, "arco_update_settings", {
      expectedRevision: current.revision,
      patch,
    });
  }
  return session;
}

async function calls(page: Page, name: string) {
  const events = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  ) as {
    type: string;
    value: { name?: string; arguments?: Record<string, unknown> };
  }[];
  return events
    .filter((event) => event.type === "tool" && event.value.name === name)
    .map((event) => event.value.arguments!);
}

async function open(page: Page, session: string, query = "") {
  await page.goto(`/?session=${session}${query}`);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await expect(selectControl(app(page), "GitHub scope")).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
}

test.beforeEach(async ({ context }) => {
  errors.set(context, []);
  const listen = (page: Page) =>
    page.on("pageerror", (error) => errors.get(context)!.push(error.message));
  context.pages().forEach(listen);
  context.on("page", listen);
});

test.afterEach(async ({ context }) => {
  expect(errors.get(context)).toEqual([]);
});

test("the global entry starts My issues despite a saved repository", async ({
  page,
}) => {
  const session = await sessionWithSettings(page, {
    activeGithubRepo: "yu/Other",
    githubRepos: ["yu/Other"],
  });
  await open(page, session);
  const ui = app(page);
  await expect(ui.locator("[data-viewer]")).toHaveAttribute(
    "data-viewer",
    "personal",
  );
  await expect(ui.locator(".viewer-title")).toHaveText("My issues");
  await expect(selectControl(ui, "GitHub scope")).toHaveAttribute(
    "data-value",
    "account:assigned",
  );
  await expect(ui.locator(".issue-sidebar .row-meta")).toContainText(
    "yu/Arco #42",
  );
  await expect
    .poll(async () => (await calls(page, "arco_account_issues")).length)
    .toBeGreaterThan(0);
  expect(await calls(page, "arco_list_issues")).toEqual([]);
});

test("the project entry uses its detected repository instead of personal settings", async ({
  page,
}) => {
  const session = await sessionWithSettings(page, {
    activeGithubRepo: "yu/Other",
    activeSource: "linear",
    projectGithubRepos: { [projectKey]: "yu/Other" },
  });
  await open(page, session, "&entry=project");
  const ui = app(page);
  await expect(ui.locator("[data-viewer]")).toHaveAttribute(
    "data-viewer",
    "project",
  );
  await expect(ui.locator(".viewer-title")).toHaveText("Project issues");
  await expect(selectControl(ui, "Issue source")).toHaveAttribute(
    "data-value",
    "github",
  );
  await expect(selectControl(ui, "GitHub scope")).toHaveAttribute(
    "data-value",
    "yu/Arco",
  );
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  expect(await calls(page, "arco_account_issues")).toEqual([]);
  const lists = await calls(page, "arco_list_issues");
  expect(lists.length).toBeGreaterThan(0);
  expect(lists.every((input) => input.repo === "yu/Arco")).toBe(true);
  await selectControl(ui, "GitHub scope").getByRole("button").click();
  await expect(
    ui.getByRole("dialog").getByText("Account views", { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
});

for (const shared of ["github", "linear"]) {
  test(`a ${shared} chat attachment does not replace the project repository viewer`, async ({
    page,
  }) => {
    const session = await sessionWithSettings(page);
    await open(page, session, `&entry=project&shared=${shared}`);
    const ui = app(page);
    await expect(ui.locator("[data-viewer]")).toHaveAttribute(
      "data-viewer",
      "project",
    );
    await expect(ui.locator(".viewer-title")).toHaveText("Project issues");
    await expect(selectControl(ui, "Issue source")).toHaveAttribute(
      "data-value",
      "github",
    );
    await expect(selectControl(ui, "GitHub scope")).toHaveAttribute(
      "data-value",
      "yu/Arco",
    );
    await expect(
      ui.getByRole("heading", { name: firstTitle, exact: true }),
    ).toBeVisible();
    expect(await calls(page, "arco_account_issues")).toEqual([]);
    const lists = await calls(page, "arco_list_issues");
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((input) => input.repo === "yu/Arco")).toBe(true);
  });
}

for (const variant of ["none", "ambiguous"]) {
  test(`a project with ${variant} repository detection waits for an explicit choice`, async ({
    page,
  }) => {
    const session = await sessionWithSettings(page, {
      activeGithubRepo: "yu/Other",
    });
    await open(page, session, `&entry=project&repo=${variant}`);
    const ui = app(page);
    await expect(ui.locator(".viewer-title")).toHaveText("Project issues");
    await expect(ui.locator(".project-repository-empty strong")).toHaveText(
      "Choose a repository",
    );
    await expect(ui.locator(".viewer-description")).toHaveText(
      variant === "none" ? "Repository for this chat" : "Repository for Arco",
    );
    await expect(ui.locator(".issue-row")).toHaveCount(0);
    await expect(selectControl(ui, "GitHub scope")).toHaveAttribute(
      "data-value",
      "",
    );
    expect(await calls(page, "arco_account_issues")).toEqual([]);
    expect(await calls(page, "arco_list_issues")).toEqual([]);
    await ui
      .locator(".project-repository-empty")
      .getByRole("button", { name: "Choose repository", exact: true })
      .click();
    const menu = ui.getByRole("dialog");
    await expect(menu.getByText("Account views", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      menu.getByRole("option", { name: "yu/Arco", exact: true }),
    ).toBeVisible();
    if (variant === "ambiguous")
      await expect(
        menu.getByRole("option", { name: "yu/Other", exact: true }),
      ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      selectControl(ui, "GitHub scope").getByRole("button"),
    ).toBeFocused();
  });
}

test("a manual repository is remembered within the same chat without using another chat's choice", async ({
  page,
}) => {
  const session = await sessionWithSettings(page, {
    activeGithubRepo: "yu/Other",
    projectGithubRepos: { [otherProjectKey]: "yu/Other" },
  });
  await open(page, session, "&entry=project&repo=none");
  const ui = app(page);
  await expect(ui.locator(".project-repository-empty strong")).toHaveText(
    "Choose a repository",
  );
  await expect(ui.locator(".viewer-description")).toHaveText(
    "Repository for this chat",
  );
  await choose(ui, "GitHub scope", "yu/Arco");
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await tool<SettingsRecord>(page, session, "arco_get_settings"))
          .settings.projectGithubRepos,
    )
    .toEqual({
      [projectKey]: "yu/Arco",
      [otherProjectKey]: "yu/Other",
    });
  const saved = await tool<SettingsRecord>(page, session, "arco_get_settings");
  expect(saved.settings.activeGithubRepo).toBe("yu/Other");
  await page.reload();
  await expect(ui.locator(".viewer-description")).toHaveText(
    "Repository for this chat",
  );
  await expect(selectControl(ui, "GitHub scope")).toHaveAttribute(
    "data-value",
    "yu/Arco",
  );
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  expect(await calls(page, "arco_account_issues")).toEqual([]);
});

test("choosing a repository at capacity keeps the newest 100 chat bindings and repositories", async ({
  page,
  context,
}) => {
  const repositories = Array.from(
    { length: 100 },
    (_, index) => `yu/saved-${index}`,
  );
  const bindings = Object.fromEntries(
    repositories.map((repo, index) => [
      (index + 1).toString(16).padStart(64, "0"),
      repo,
    ]),
  );
  const accountFilter = {
    filter: "mentioned" as const,
    state: "all" as const,
    sort: "created" as const,
    order: "asc" as const,
  };
  const session = await sessionWithSettings(page, {
    githubRepos: repositories,
    projectGithubRepos: bindings,
    activeGithubRepo: repositories[99],
    githubAccountFilter: accountFilter,
  });
  await open(page, session, "&entry=project&repo=none");
  const ui = app(page);
  await expect(ui.locator(".project-repository-empty strong")).toHaveText(
    "Choose a repository",
  );
  await choose(ui, "GitHub scope", "yu/Arco");
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await tool<SettingsRecord>(page, session, "arco_get_settings"))
          .settings.projectGithubRepos[projectKey],
    )
    .toBe("yu/Arco");
  const { settings: saved } = await tool<SettingsRecord>(
    page,
    session,
    "arco_get_settings",
  );
  expect(Object.keys(saved.projectGithubRepos)).toHaveLength(100);
  expect(saved.projectGithubRepos[Object.keys(bindings)[0]]).toBeUndefined();
  expect(saved.projectGithubRepos[Object.keys(bindings)[99]]).toBe(
    repositories[99],
  );
  expect(saved.githubRepos).toHaveLength(100);
  expect(saved.githubRepos).not.toContain(repositories[0]);
  expect(saved.githubRepos.at(-1)).toBe("yu/Arco");
  expect(saved.activeGithubRepo).toBe(repositories[99]);
  expect(saved.githubAccountFilter).toEqual(accountFilter);
  await expect(ui.locator(".settings-error")).toHaveCount(0);

  await page.reload();
  await expect(selectControl(ui, "GitHub scope")).toHaveAttribute(
    "data-value",
    "yu/Arco",
  );
  await expect(ui.locator(".viewer-description")).toHaveText(
    "Repository for this chat",
  );
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  const personalPage = await context.newPage();
  await open(personalPage, session);
  await expect(app(personalPage).locator(".viewer-title")).toHaveText(
    "My issues",
  );
  await expect(
    selectControl(app(personalPage), "GitHub scope"),
  ).toHaveAttribute("data-value", "account:mentioned");
});

test("personal and project filters survive separate tabs without leaking source choices", async ({
  page,
  context,
}) => {
  const session = await sessionWithSettings(page);
  await open(page, session);
  const personal = app(page);
  await choose(personal, "GitHub scope", "account:mentioned");
  await personal.getByRole("button", { name: "All", exact: true }).click();
  await expect(personal.locator(".issue-row")).toContainText(mentionedTitle);
  await expect
    .poll(
      async () =>
        (await tool<SettingsRecord>(page, session, "arco_get_settings"))
          .settings.githubAccountFilter,
    )
    .toMatchObject({
      filter: "mentioned",
      state: "all",
    });

  const projectPage = await context.newPage();
  await open(projectPage, session, "&entry=project");
  const project = app(projectPage);
  await project
    .getByRole("textbox", { name: "Search issues", exact: true })
    .fill("Keep Issue");
  await project.getByRole("button", { name: "Closed", exact: true }).click();
  await expect(project.locator(".issue-row")).toContainText(
    "Keep Issue state separate from Projects Status",
  );
  await expect
    .poll(
      async () =>
        (await tool<SettingsRecord>(page, session, "arco_get_settings"))
          .settings.githubFilters["yu/Arco"],
    )
    .toMatchObject({
      query: "Keep Issue",
      state: "closed",
    });
  await choose(project, "Issue source", "linear");
  await expect(selectControl(project, "Linear Team")).toBeVisible();
  const saved = await tool<SettingsRecord>(page, session, "arco_get_settings");
  expect(saved.settings.activeSource).toBe("github");

  await page.reload();
  await expect(personal.locator(".viewer-title")).toHaveText("My issues");
  await expect(selectControl(personal, "GitHub scope")).toHaveAttribute(
    "data-value",
    "account:mentioned",
  );
  await expect(
    personal.getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await projectPage.reload();
  await expect(project.locator(".viewer-title")).toHaveText("Project issues");
  await expect(selectControl(project, "Issue source")).toHaveAttribute(
    "data-value",
    "github",
  );
  await expect(
    project.getByRole("textbox", { name: "Search issues", exact: true }),
  ).toHaveValue("Keep Issue");
  await expect(
    project.getByRole("button", { name: "Closed", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await calls(projectPage, "arco_account_issues")).toEqual([]);
});

test("external issue results and host presentation changes preserve the project viewer", async ({
  page,
}) => {
  const session = await sessionWithSettings(page);
  await open(page, session, "&entry=project");
  const ui = app(page);
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mock external update #42", exact: true })
    .click();
  await expect(
    ui.getByRole("heading", {
      name: "Issue updated by a Codex tool",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("Mock host events", { exact: true }).click();
  await page
    .getByRole("button", { name: "Mock presentation updates", exact: true })
    .click();
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(ui.locator(".compact-mode")).toBeVisible();
  await expect(ui.locator(".issue-kicker")).toContainText("yu/Arco #42");
  await expect(
    ui.getByRole("heading", {
      name: "Issue updated by a Codex tool",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mock fullscreen", exact: true })
    .click();
  await expect(ui.locator("[data-viewer]")).toHaveAttribute(
    "data-viewer",
    "project",
  );
  await expect(ui.locator(".viewer-title")).toHaveText("Project issues");
  await expect(selectControl(ui, "GitHub scope")).toHaveAttribute(
    "data-value",
    "yu/Arco",
  );
  await expect(
    ui.getByRole("heading", {
      name: "Issue updated by a Codex tool",
      exact: true,
    }),
  ).toBeVisible();
  expect(await calls(page, "arco_account_issues")).toEqual([]);
});
