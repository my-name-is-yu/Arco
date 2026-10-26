import { expect, test, type BrowserContext, type Page } from "./browser-test";
import type { Settings, SettingsRecord } from "../src/shared/state";
import type { NativeIssueTarget } from "../src/shared/launch";
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

async function hostEvents(page: Page, type: string) {
  const events = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  ) as { type: string; value: unknown }[];
  return events
    .filter((event) => event.type === type)
    .map((event) => event.value);
}

const nativeTarget = (
  source: "github" | "linear",
  number: number,
): NativeIssueTarget =>
  source === "github"
    ? { source, repo: "yu/Arco", number }
    : {
        source,
        connectionId: "default",
        workspaceId: "fixture-linear-workspace",
        teamId: "fixture-linear-team",
        issueId: `fixture-linear-${number}`,
      };
const issueTitles = {
  github: { 42: firstTitle, 43: mentionedTitle },
  linear: {
    42: "Keep Linear workflow states intact",
    43: "Share a Linear issue with the Codex chat",
  },
};

async function open(page: Page, session: string, query = "") {
  await page.goto(`/?session=${session}${query}`);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await expect(selectControl(app(page), "GitHub view")).toBeVisible();
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
  expect(await hostEvents(page, "display")).toEqual(["fullscreen"]);
  expect(await hostEvents(page, "display-request")).toEqual([]);
  await expect(ui.locator("[data-viewer]")).toHaveAttribute(
    "data-viewer",
    "personal",
  );
  await expect(ui.locator(".viewer-title")).toHaveText("My issues");
  await expect(selectControl(ui, "GitHub view")).toHaveAttribute(
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
  expect(await hostEvents(page, "display")).toEqual(["fullscreen"]);
  expect(await hostEvents(page, "display-request")).toEqual([]);
  await expect(ui.locator("[data-viewer]")).toHaveAttribute(
    "data-viewer",
    "project",
  );
  await expect(ui.locator(".viewer-title")).toHaveText("Arco issues");
  await expect(selectControl(ui, "Issue source")).toHaveAttribute(
    "data-value",
    "github",
  );
  await expect(selectControl(ui, "GitHub view")).toHaveAttribute(
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
  await selectControl(ui, "GitHub view").getByRole("button").click();
  await expect(
    ui.getByRole("dialog").getByText("Across repositories", { exact: true }),
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
    await expect(ui.locator(".viewer-title")).toHaveText("Arco issues");
    await expect(selectControl(ui, "Issue source")).toHaveAttribute(
      "data-value",
      "github",
    );
    await expect(selectControl(ui, "GitHub view")).toHaveAttribute(
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
    await expect(ui.locator(".viewer-title")).toHaveText(
      variant === "none" ? "Issues for this chat" : "Arco issues",
    );
    await expect(ui.locator(".project-repository-empty strong")).toHaveText(
      "Choose a repository",
    );
    await expect(ui.locator(".scope-control")).toHaveAttribute(
      "title",
      "Repository selection is saved for this chat.",
    );
    await expect(ui.locator(".issue-row")).toHaveCount(0);
    await expect(selectControl(ui, "GitHub view")).toHaveAttribute(
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
    await expect(
      menu.getByText("Across repositories", { exact: true }),
    ).toHaveCount(0);
    await expect(
      menu.getByRole("option", { name: "yu/Arco", exact: true }),
    ).toBeVisible();
    if (variant === "ambiguous")
      await expect(
        menu.getByRole("option", { name: "yu/Other", exact: true }),
      ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      selectControl(ui, "GitHub view").getByRole("button"),
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
  await expect(ui.locator(".scope-control")).toHaveAttribute(
    "title",
    "Repository selection is saved for this chat.",
  );
  await choose(ui, "GitHub view", "yu/Arco");
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
  await expect(ui.locator(".scope-control")).toHaveAttribute(
    "title",
    "Repository selection is saved for this chat.",
  );
  await expect(selectControl(ui, "GitHub view")).toHaveAttribute(
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
  await selectControl(ui, "GitHub view").getByRole("button").click();
  await ui.getByRole("dialog").getByRole("combobox").fill("yu/Arco");
  await choose(ui, "GitHub view", "yu/Arco");
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
  await expect(selectControl(ui, "GitHub view")).toHaveAttribute(
    "data-value",
    "yu/Arco",
  );
  await expect(ui.locator(".scope-control")).toHaveAttribute(
    "title",
    "Repository selection is saved for this chat.",
  );
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  const personalPage = await context.newPage();
  await open(personalPage, session);
  await expect(app(personalPage).locator(".viewer-title")).toHaveText(
    "My issues",
  );
  await expect(selectControl(app(personalPage), "GitHub view")).toHaveAttribute(
    "data-value",
    "account:mentioned",
  );
});

test("personal and project filters survive separate tabs without leaking source choices", async ({
  page,
  context,
}) => {
  const session = await sessionWithSettings(page);
  await open(page, session);
  const personal = app(page);
  await choose(personal, "GitHub view", "account:mentioned");
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
  await expect(selectControl(personal, "GitHub view")).toHaveAttribute(
    "data-value",
    "account:mentioned",
  );
  await expect(
    personal.getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await projectPage.reload();
  await expect(project.locator(".viewer-title")).toHaveText("Arco issues");
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
  await expect(ui.locator(".inline-card-top")).toContainText("yu/Arco #42");
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
  await expect(ui.locator(".viewer-title")).toHaveText("Arco issues");
  await expect(selectControl(ui, "GitHub view")).toHaveAttribute(
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

for (const source of ["github", "linear"] as const) {
  test(
    `${source} show uses its inline metadata and keeps the exact issue across details and browsing`,
    { tag: "@smoke" },
    async ({ page }) => {
      const session = await sessionWithSettings(page, {
        activeSource: source === "github" ? "linear" : "github",
      });
      const sharedSource = source === "github" ? "linear" : "github";
      await page.goto(
        `/?session=${session}&entry=issue&source=${source}&number=43&shared=${sharedSource}&sharedRepo=yu/Arco`,
      );
      await expect(page.locator("#bridge-status")).toHaveText("ready");
      const ui = app(page);
      const card = ui.locator(".inline-issue-card");
      await expect(
        card.getByRole("heading", {
          name: issueTitles[source][43],
          exact: true,
        }),
      ).toBeVisible();
      expect(await hostEvents(page, "presentation")).toEqual([
        {
          tool: "arco_show_issue",
          resourceUri: "ui://arco/issue-card",
          preferredMode: "inline",
          availableDisplayModes: ["inline", "fullscreen"],
        },
      ]);
      expect(await hostEvents(page, "display")).toEqual(["inline"]);
      expect(await hostEvents(page, "display-request")).toEqual([]);
      expect((await hostEvents(page, "launch")).at(-1)).toMatchObject({
        target: nativeTarget(source, 43),
      });
      expect(await calls(page, "arco_update_settings")).toEqual([]);

      await card
        .getByRole("button", { name: "Open details", exact: true })
        .click();

      await expect
        .poll(async () => (await hostEvents(page, "display")).at(-1))
        .toBe("fullscreen");
      await expect(
        ui.getByRole("heading", { name: issueTitles[source][43], exact: true }),
      ).toBeVisible();
      await ui
        .locator(".issue-row")
        .filter({ hasText: issueTitles[source][42] })
        .click();
      await expect(
        ui.getByRole("heading", { name: issueTitles[source][42], exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Mock inline", exact: true })
        .click();
      await expect(
        card.getByRole("heading", {
          name: issueTitles[source][43],
          exact: true,
        }),
      ).toBeVisible();
      expect(await hostEvents(page, "context")).toEqual([]);
      expect(await hostEvents(page, "message")).toEqual([]);
      await expect(page.locator("#harness-error")).toBeEmpty();
    },
  );

  test(`${source} explicit issue details start fullscreen from metadata without substituting the first list row`, async ({
    page,
  }) => {
    const session = await sessionWithSettings(page);
    await page.goto(
      `/?session=${session}&entry=detail&source=${source}&number=43`,
    );
    await expect(page.locator("#bridge-status")).toHaveText("ready");
    const ui = app(page);
    await expect(
      ui.getByRole("heading", { name: issueTitles[source][43], exact: true }),
    ).toBeVisible();
    await expect(ui.locator(".inline-mode")).toHaveCount(0);
    expect(await hostEvents(page, "presentation")).toEqual([
      {
        tool: "arco_open_issue",
        resourceUri: "ui://arco/issues",
        preferredMode: "fullscreen",
        availableDisplayModes: ["inline", "fullscreen"],
      },
    ]);
    expect(await hostEvents(page, "display")).toEqual(["fullscreen"]);
    expect(await hostEvents(page, "display-request")).toEqual([]);
    expect((await hostEvents(page, "launch")).at(-1)).toMatchObject({
      target: nativeTarget(source, 43),
    });
    expect(await calls(page, "arco_update_settings")).toEqual([]);
    expect(await hostEvents(page, "context")).toEqual([]);
    expect(await hostEvents(page, "message")).toEqual([]);
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}

test("a dedicated issue card preserves another project's browsing, filter, shared target and unsent draft", async ({
  page,
  context,
}) => {
  const session = await sessionWithSettings(page);
  await open(page, session, "&entry=project");
  const workspace = app(page);
  await workspace
    .getByRole("textbox", { name: "Search issues", exact: true })
    .fill("Separate");
  await workspace
    .locator(".issue-row")
    .filter({ hasText: mentionedTitle })
    .click();
  await expect(
    workspace.getByRole("heading", { name: mentionedTitle, exact: true }),
  ).toBeVisible();
  const comment = "Keep this unsent comment in the existing project panel.";
  await workspace
    .getByRole("textbox", { name: "Comment on GitHub", exact: true })
    .fill(comment);
  await workspace
    .getByRole("button", { name: "Add to chat", exact: true })
    .click();
  await expect.poll(() => hostEvents(page, "context")).toHaveLength(1);
  const shared = await hostEvents(page, "context");
  await expect
    .poll(
      async () =>
        (await tool<SettingsRecord>(page, session, "arco_get_settings"))
          .settings.githubFilters["yu/Arco"]?.query,
    )
    .toBe("Separate");
  const before = await tool<SettingsRecord>(page, session, "arco_get_settings");
  const cardPage = await context.newPage();

  await cardPage.goto(
    `/?session=${session}&entry=issue&source=github&number=42&shared=github&sharedRepo=yu/Arco&sharedNumber=43`,
  );

  await expect(
    app(cardPage)
      .locator(".inline-issue-card")
      .getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("heading", { name: mentionedTitle, exact: true }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("textbox", { name: "Search issues", exact: true }),
  ).toHaveValue("Separate");
  await expect(
    workspace.getByRole("textbox", { name: "Comment on GitHub", exact: true }),
  ).toHaveValue(comment);
  expect(
    await tool<SettingsRecord>(page, session, "arco_get_settings"),
  ).toEqual(before);
  expect(await calls(cardPage, "arco_update_settings")).toEqual([]);
  expect(await hostEvents(page, "context")).toEqual(shared);
  expect(await hostEvents(cardPage, "context")).toEqual([]);
  expect(await hostEvents(cardPage, "message")).toEqual([]);
});

test("a dedicated Linear issue reports a different connected workspace without falling back to its issue list", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "linear_connection") return route.fallback();
    const response = await route.fetch();
    const result = await response.json();
    result.structuredContent.workspace = {
      id: "other-workspace",
      name: "Other workspace",
    };
    return route.fulfill({ response, json: result });
  });
  const session = await sessionWithSettings(page);
  await page.goto(`/?session=${session}&entry=issue&source=linear&number=43`);
  const ui = app(page);
  await expect(ui.getByRole("alert")).toHaveText(
    "The connected Linear workspace does not match this issue.",
  );
  await expect(ui.locator(".inline-issue-card")).toHaveCount(0);
  await expect(
    ui.getByRole("heading", { name: issueTitles.linear[42], exact: true }),
  ).toHaveCount(0);
  await expect(
    ui.getByRole("heading", { name: issueTitles.linear[43], exact: true }),
  ).toHaveCount(0);
  expect(await calls(page, "linear_get_issue")).toEqual([]);
  expect(await calls(page, "linear_list_issues")).toEqual([]);
  expect(await calls(page, "arco_update_settings")).toEqual([]);
  expect(await hostEvents(page, "context")).toEqual([]);
  expect(await hostEvents(page, "message")).toEqual([]);
});

for (const source of ["github", "linear"] as const) {
  test(`the common workspace opens requested ${source} ahead of saved and shared source without locking later switches`, async ({
    page,
  }) => {
    const other = source === "github" ? "linear" : "github";
    const session = await sessionWithSettings(page, { activeSource: other });
    const before = await tool<SettingsRecord>(
      page,
      session,
      "arco_get_settings",
    );

    await page.goto(
      `/?session=${session}&source=${source}&shared=${other}&sharedRepo=yu/Arco`,
    );

    await expect(page.locator("#bridge-status")).toHaveText("ready");
    const ui = app(page);
    const sourceControl = selectControl(ui, "Issue source");
    await expect(sourceControl).toHaveAttribute("data-value", source);
    await expect(
      ui.getByRole("heading", { name: issueTitles[source][42], exact: true }),
    ).toBeVisible();
    expect((await hostEvents(page, "launch")).at(-1)).toMatchObject({
      view: "personal",
      source,
    });
    expect(await hostEvents(page, "display")).toEqual(["fullscreen"]);
    expect(await hostEvents(page, "display-request")).toEqual([]);
    expect(await calls(page, "arco_update_settings")).toEqual([]);
    expect(
      await tool<SettingsRecord>(page, session, "arco_get_settings"),
    ).toEqual(before);
    expect(await hostEvents(page, "context")).toEqual([]);

    await choose(ui, "Issue source", other);

    await expect(sourceControl).toHaveAttribute("data-value", other);
    await expect(
      ui.getByRole("heading", { name: issueTitles[other][42], exact: true }),
    ).toBeVisible();
    expect(await hostEvents(page, "context")).toEqual([]);
    expect(await hostEvents(page, "message")).toEqual([]);
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}
