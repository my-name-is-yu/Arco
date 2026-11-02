import { SYMPHONY_FIXTURE_CONNECTIONS } from "../src/server/symphony-fixture";
import { expect, test, type Page } from "./browser-test";
import type { SettingsRecord } from "../src/shared/state";
import type { SymphonySnapshot } from "../src/shared/symphony";
import { choose, selectControl } from "./select-helpers";

const app = (page: Page) => page.frameLocator("#arco");
const githubTitle = "Preserve issue selection and scroll position";
const linearTitle = "Keep Linear workflow states intact";
const githubConnection = "fixture-symphony-github";
const linearConnection = "fixture-symphony-linear";

async function open(page: Page) {
  const response = await page.request.post("/session");
  expect(response.ok()).toBe(true);
  const { session } = (await response.json()) as { session: string };
  const read = await page.request.post("/tool", {
    data: { session, name: "arco_get_settings", arguments: {} },
  });
  const current = (await read.json()).structuredContent as SettingsRecord;
  const saved = await page.request.post("/tool", {
    data: {
      session,
      name: "arco_update_settings",
      arguments: {
        expectedRevision: current.revision,
        patch: {
          activeSource: "symphony",
          symphonyConnections: SYMPHONY_FIXTURE_CONNECTIONS,
          activeSymphonyConnectionId: githubConnection,
          symphonyLayout: "board",
        },
      },
    },
  });
  expect((await saved.json()).isError).not.toBe(true);
  await page.goto(`/?session=${session}&source=symphony`);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await expect(
    app(page).getByRole("main", { name: "Symphony workspace" }),
  ).toBeVisible();
}

function detail(page: Page) {
  return app(page).getByRole("complementary", {
    name: "Symphony work details",
  });
}

function work(page: Page, identifier: string, title: string) {
  return app(page).getByRole("button", {
    name: `${identifier}: ${title}`,
    exact: true,
  });
}

test("same-number runtime from another repository stays separate through native View run @smoke", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { connectionId?: string };
    };
    if (
      input.name !== "arco_symphony_state" ||
      input.arguments.connectionId !== githubConnection
    )
      return route.continue();
    const response = await route.fetch();
    const result = (await response.json()) as {
      structuredContent: SymphonySnapshot;
    };
    const runtime = result.structuredContent.rows.find(
      (row) => row.issueIdentifier === "GH-42",
    );
    expect(runtime).toBeDefined();
    runtime!.issueUrl = "https://github.com/other/project/issues/42";
    runtime!.lastMessage = "This runtime belongs to another repository.";
    return route.fulfill({ response, json: result });
  });
  await open(page);
  const ui = app(page);
  const native = work(page, "GH-42", githubTitle);
  const runtime = work(page, "GH-42", "GH-42");
  await expect(native).toBeVisible();
  await expect(runtime).toBeVisible();
  await native.click();
  await expect(native).toHaveAttribute("aria-pressed", "true");
  await expect(runtime).toHaveAttribute("aria-pressed", "false");
  await expect(
    detail(page).getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
  await expect(detail(page)).toContainText("No active run");
  await expect(detail(page)).toContainText(
    "Return to the same position when switching between issues.",
  );
  await expect(
    detail(page).getByRole("button", { name: "Add run context to chat" }),
  ).toHaveCount(0);

  await detail(page)
    .getByRole("button", { name: "Open issue", exact: true })
    .click();
  const runSection = ui.getByRole("region", {
    name: "Symphony run",
    exact: true,
  });
  await expect(runSection).toContainText("No active run");
  await runSection
    .getByRole("button", { name: "View run", exact: true })
    .click();
  await expect(
    detail(page).getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
  await expect(native).toHaveAttribute("aria-pressed", "true");
  await expect(runtime).toHaveAttribute("aria-pressed", "false");
  await expect(detail(page)).toContainText("No active run");
  await expect(detail(page)).not.toContainText(
    "This runtime belongs to another repository.",
  );

  await runtime.click();
  await expect(runtime).toHaveAttribute("aria-pressed", "true");
  await expect(native).toHaveAttribute("aria-pressed", "false");
  await expect(
    detail(page).getByRole("heading", { name: "GH-42", exact: true }),
  ).toBeVisible();
  await expect(detail(page)).toContainText(
    "This runtime belongs to another repository.",
  );
  await expect(detail(page)).not.toContainText(
    "Return to the same position when switching between issues.",
  );
  await expect(
    detail(page).getByRole("button", { name: "Open issue", exact: true }),
  ).toHaveCount(0);
  await choose(ui, "Issue source", "github");
  await expect(
    ui.getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
  await ui
    .getByRole("region", { name: "Symphony run", exact: true })
    .getByRole("button", { name: "View run", exact: true })
    .click();
  await expect(
    detail(page).getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
  await expect(detail(page)).toContainText("No active run");
  await expect(runtime).toHaveAttribute("aria-pressed", "false");
  await ui.getByRole("button", { name: "Table view", exact: true }).click();
  await expect(native).toHaveAttribute("aria-pressed", "true");
  await native.click();
  await expect(
    detail(page).getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
  await expect(detail(page)).toContainText("No active run");
});

test("an unloaded native View run target hides remembered runtime details and yields to explicit navigation", async ({
  page,
}) => {
  let hideNativeIssue = false;
  let omittedReads = 0;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { connectionId?: string };
    };
    if (input.name === "arco_list_issues" && hideNativeIssue) {
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.issues = result.structuredContent.issues.filter(
        (issue: { number: number }) => issue.number !== 42,
      );
      omittedReads += 1;
      return route.fulfill({ response, json: result });
    }
    if (
      input.name === "arco_symphony_state" &&
      input.arguments.connectionId === githubConnection
    ) {
      const response = await route.fetch();
      const result = (await response.json()) as {
        structuredContent: SymphonySnapshot;
      };
      const runtime = result.structuredContent.rows.find(
        (row) => row.issueIdentifier === "GH-42",
      )!;
      runtime.issueUrl = "https://github.com/other/project/issues/42";
      return route.fulfill({ response, json: result });
    }
    return route.continue();
  });
  await open(page);
  const ui = app(page);
  const native = work(page, "GH-42", githubTitle);
  const foreign = work(page, "GH-42", "GH-42");
  const otherTitle = "Separate shared context from sending a request";
  const other = work(page, "GH-43", otherTitle);

  await native.click();
  await detail(page)
    .getByRole("button", { name: "Open issue", exact: true })
    .click();
  await choose(ui, "Issue source", "symphony");
  await choose(ui, "Symphony connection", linearConnection);
  await work(page, "YU-42", linearTitle).click();
  await choose(ui, "Symphony connection", githubConnection);
  await foreign.click();
  hideNativeIssue = true;
  await ui
    .getByRole("button", { name: "Refresh Symphony", exact: true })
    .click();
  await expect(native).toHaveCount(0);
  await expect(foreign).toHaveAttribute("aria-pressed", "true");

  const requestNativeRun = async () => {
    await choose(ui, "Issue source", "github");
    await expect(
      ui.getByRole("heading", { name: githubTitle, exact: true }),
    ).toBeVisible();
    await ui
      .getByRole("region", { name: "Symphony run", exact: true })
      .getByRole("button", { name: "View run", exact: true })
      .click();
    await expect(
      ui.getByRole("main", { name: "Symphony workspace" }),
    ).toBeVisible();
    await expect(detail(page)).toHaveCount(0);
    await expect(ui.getByRole("status")).toContainText(
      "The selected issue is not in the loaded work.",
    );
    await expect(foreign).toHaveAttribute("aria-pressed", "false");
  };
  await requestNativeRun();
  await other.click();
  await expect(ui.getByRole("status")).toHaveCount(0);
  const beforeRefresh = omittedReads;
  await ui
    .getByRole("button", { name: "Refresh Symphony", exact: true })
    .click();
  await expect.poll(() => omittedReads).toBeGreaterThan(beforeRefresh);
  await expect(other).toHaveAttribute("aria-pressed", "true");
  await expect(
    detail(page).getByRole("heading", { name: otherTitle, exact: true }),
  ).toBeVisible();

  await requestNativeRun();
  await choose(ui, "Symphony connection", linearConnection);
  await expect(work(page, "YU-42", linearTitle)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    detail(page).getByRole("heading", { name: linearTitle, exact: true }),
  ).toBeVisible();
  await choose(ui, "Symphony connection", githubConnection);
  await expect(other).toHaveAttribute("aria-pressed", "true");
});

test("each Symphony connection restores its own search, filter, and selected work", async ({
  page,
}) => {
  await open(page);
  const ui = app(page);
  const search = ui.getByRole("searchbox", { name: "Search Symphony work" });
  await expect(work(page, "GH-42", githubTitle)).toBeVisible();
  await search.fill("Preserve");
  await choose(ui, "Work group", "working");
  await work(page, "GH-42", githubTitle).click();
  await ui.getByRole("button", { name: "Table view", exact: true }).click();

  await choose(ui, "Symphony connection", linearConnection);
  await expect(search).toHaveValue("");
  await expect(selectControl(ui, "Work group")).toHaveAttribute(
    "data-value",
    "all",
  );
  await expect(work(page, "YU-42", linearTitle)).toBeVisible();
  await search.fill("Keep Linear");
  await choose(ui, "Work group", "attention");
  await work(page, "YU-42", linearTitle).click();
  await expect(
    detail(page).getByRole("heading", { name: linearTitle, exact: true }),
  ).toBeVisible();

  await choose(ui, "Symphony connection", githubConnection);
  await expect(search).toHaveValue("Preserve");
  await expect(selectControl(ui, "Work group")).toHaveAttribute(
    "data-value",
    "working",
  );
  await expect(work(page, "GH-42", githubTitle)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    detail(page).getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
  await expect(
    work(page, "GH-43", "Separate shared context from sending a request"),
  ).toHaveCount(0);
  await choose(ui, "Symphony connection", linearConnection);
  await expect(search).toHaveValue("Keep Linear");
  await expect(selectControl(ui, "Work group")).toHaveAttribute(
    "data-value",
    "attention",
  );
  await expect(work(page, "YU-42", linearTitle)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    detail(page).getByRole("heading", { name: linearTitle, exact: true }),
  ).toBeVisible();
});

test("credential rotation removes the old issue context while the new account scope is loading", async ({
  page,
}) => {
  let generation = "credential-a";
  let newListRequested = false;
  let releaseList!: () => void;
  const pendingList = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    const requestedGeneration = generation;
    if (input.name === "arco_connection") {
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.authGeneration = requestedGeneration;
      return route.fulfill({ response, json: result });
    }
    if (
      input.name === "arco_list_issues" &&
      requestedGeneration === "credential-b"
    ) {
      newListRequested = true;
      await pendingList;
      const response = await route.fetch();
      const result = await response.json();
      for (const issue of result.structuredContent.issues) {
        if (issue.number === 42) issue.title = "Current credential issue";
      }
      return route.fulfill({ response, json: result });
    }
    if (
      input.name === "arco_get_issue" &&
      requestedGeneration === "credential-b"
    ) {
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.title = "Current credential issue";
      result.structuredContent.body = "Current credential requirements.";
      return route.fulfill({ response, json: result });
    }
    return route.continue();
  });
  try {
    await open(page);
    await work(page, "GH-42", githubTitle).click();
    await expect(detail(page)).toContainText(
      "Return to the same position when switching between issues.",
    );
    generation = "credential-b";
    await app(page)
      .getByRole("button", { name: "Refresh Symphony", exact: true })
      .click();
    await expect.poll(() => newListRequested).toBe(true);
    await expect(detail(page)).not.toContainText(githubTitle);
    await expect(detail(page)).not.toContainText(
      "Return to the same position when switching between issues.",
    );
    await expect(detail(page)).toContainText("Running");
    releaseList();
    await expect(detail(page)).toContainText(
      "Current credential requirements.",
    );
    await expect(
      detail(page).getByRole("heading", {
        name: "Current credential issue",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    releaseList();
  }
});

for (const source of ["github", "linear"] as const) {
  const connectionId =
    source === "github" ? githubConnection : linearConnection;
  const identifier = source === "github" ? "GH-42" : "YU-42";
  const title = source === "github" ? githubTitle : linearTitle;

  test(`${source} selection follows runtime start, stop and restart`, async ({
    page,
  }) => {
    let phase = 0;
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { connectionId?: string };
      };
      if (
        input.name !== "arco_symphony_state" ||
        input.arguments.connectionId !== connectionId
      )
        return route.continue();
      const response = await route.fetch();
      const result = (await response.json()) as {
        structuredContent: SymphonySnapshot;
      };
      result.structuredContent.rows = result.structuredContent.rows.flatMap(
        (row) =>
          row.issueIdentifier !== identifier
            ? [row]
            : phase % 2 === 0
              ? []
              : [
                  {
                    ...row,
                    issueId: `attempt-${phase}`,
                    key: JSON.stringify([connectionId, `attempt-${phase}`]),
                    runtimeStatus: "running" as const,
                    lastMessage: `Execution attempt ${phase}`,
                    error: null,
                  },
                ],
      );
      return route.fulfill({ response, json: result });
    });
    await open(page);
    const ui = app(page);
    if (source === "linear")
      await choose(ui, "Symphony connection", connectionId);
    const selected = work(page, identifier, title);
    await selected.click();
    await expect(detail(page)).toContainText("No active run");
    for (phase = 1; phase <= 3; phase += 1) {
      await ui
        .getByRole("button", { name: "Refresh Symphony", exact: true })
        .click();
      if (phase % 2) {
        await expect(detail(page)).toContainText(`Execution attempt ${phase}`);
        await expect(
          detail(page).getByText("Running", { exact: true }),
        ).toBeVisible();
      } else {
        await expect(detail(page)).toContainText("No active run");
      }
      await expect(selected).toHaveAttribute("aria-pressed", "true");
      await expect(detail(page)).not.toContainText(
        "This work is no longer in the current snapshot.",
      );
    }
  });

  test(`${source} restores the reading position after View run with delayed context`, async ({
    page,
  }) => {
    await page.clock.install();
    let restarted = false;
    let sawRestart = false;
    let delayContext = false;
    let contextRequested = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { connectionId?: string; number?: number; issueId?: string };
      };
      if (
        input.name === "arco_symphony_state" &&
        input.arguments.connectionId === connectionId
      ) {
        const response = await route.fetch();
        const result = (await response.json()) as {
          structuredContent: SymphonySnapshot;
        };
        if (restarted) {
          const row = result.structuredContent.rows.find(
            (row) => row.issueIdentifier === identifier,
          )!;
          row.issueId = "new-attempt";
          row.key = JSON.stringify([connectionId, row.issueId]);
          sawRestart = true;
        }
        return route.fulfill({ response, json: result });
      }
      if (
        (source === "github" &&
          input.name === "arco_get_issue" &&
          input.arguments.number === 42) ||
        (source === "linear" &&
          input.name === "linear_get_issue" &&
          input.arguments.issueId === "fixture-linear-42")
      ) {
        if (delayContext) {
          contextRequested = true;
          await pending;
        }
        const response = await route.fetch();
        const result = await response.json();
        result.structuredContent.body = Array.from(
          { length: 80 },
          (_, index) => `Paragraph ${index + 1}. Saved reading position.`,
        ).join("\n\n");
        return route.fulfill({ response, json: result });
      }
      return route.continue();
    });
    try {
      await open(page);
      const ui = app(page);
      if (source === "linear")
        await choose(ui, "Symphony connection", connectionId);
      await work(page, identifier, title).click();
      await expect(detail(page)).toContainText("Paragraph 80.");
      const position = await detail(page).evaluate((element) => {
        element.scrollTop = 450;
        return element.scrollTop;
      });
      expect(position).toBe(450);
      // Invoke navigation without Playwright scrolling the offscreen action into view.
      await detail(page)
        .getByRole("button", { name: "Open issue", exact: true })
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect(ui.locator(".detail-scroll")).toBeVisible();
      restarted = true;
      await page.clock.fastForward(5_100);
      await expect.poll(() => sawRestart).toBe(true);
      delayContext = true;
      await ui
        .getByRole("region", { name: "Symphony run", exact: true })
        .getByRole("button", { name: "View run", exact: true })
        .click();
      await expect.poll(() => contextRequested).toBe(true);
      await expect(detail(page)).toContainText("Loading issue context…");
      await expect(
        detail(page).getByRole("button", {
          name: "Close work details",
          exact: true,
        }),
      ).toBeFocused();
      release();
      await expect(detail(page)).toContainText("Paragraph 80.");
      await expect
        .poll(() => detail(page).evaluate((element) => element.scrollTop))
        .toBe(position);
      // Cached context must also preserve the offset despite close-button focus.
      delayContext = false;
      await detail(page)
        .getByRole("button", { name: "Open issue", exact: true })
        .evaluate((button: HTMLButtonElement) => button.click());
      await ui
        .getByRole("region", { name: "Symphony run", exact: true })
        .getByRole("button", { name: "View run", exact: true })
        .click();
      await expect(detail(page)).toContainText("Paragraph 80.");
      await expect
        .poll(() => detail(page).evaluate((element) => element.scrollTop))
        .toBe(position);
    } finally {
      release();
    }
  });
}

test("search and layout changes do not repeat the unchanged runtime/issue join", async ({
  page,
}) => {
  await open(page);
  const ui = app(page);
  await expect(work(page, "GH-42", githubTitle)).toBeVisible();
  const root = ui.locator("html");
  await root.evaluate((element) => {
    element.setAttribute("data-issue-url-parses", "0");
    const OriginalURL = URL;
    window.URL = class extends OriginalURL {
      constructor(input: string | URL, base?: string | URL) {
        super(input, base);
        if (
          String(input).includes("/issues/") ||
          String(input).includes("/issue/")
        )
          element.setAttribute(
            "data-issue-url-parses",
            String(Number(element.getAttribute("data-issue-url-parses")) + 1),
          );
      }
    };
  });
  await ui
    .getByRole("searchbox", { name: "Search Symphony work" })
    .fill("Preserve");
  await expect(
    work(page, "GH-43", "Separate shared context from sending a request"),
  ).toHaveCount(0);
  await ui.getByRole("button", { name: "Table view", exact: true }).click();
  await expect(work(page, "GH-42", githubTitle)).toBeVisible();
  await expect(root).toHaveAttribute("data-issue-url-parses", "0");
});

for (const withUrl of [true, false]) {
  test(`runtime-only selection preserves its detail and reading position when a later page arrives (${withUrl ? "URL" : "no URL"})`, async ({
    page,
  }) => {
    let showNative = false;
    let running = true;
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { connectionId?: string; number?: number };
      };
      if (input.name === "arco_get_issue" && input.arguments.number === 42) {
        const response = await route.fetch();
        const result = await response.json();
        result.structuredContent.body = Array.from(
          { length: 80 },
          (_, index) => `Paragraph ${index + 1}. Saved reading position.`,
        ).join("\n\n");
        return route.fulfill({ response, json: result });
      }
      if (
        (input.name === "arco_list_issues" && !showNative) ||
        (input.name === "arco_symphony_state" &&
          input.arguments.connectionId === githubConnection &&
          (!running || !withUrl))
      ) {
        const response = await route.fetch();
        const result = await response.json();
        if (input.name === "arco_list_issues")
          result.structuredContent.issues =
            result.structuredContent.issues.filter(
              (issue: { number: number }) => issue.number !== 42,
            );
        else {
          result.structuredContent.rows = result.structuredContent.rows.filter(
            (row: { issueIdentifier: string }) =>
              running || row.issueIdentifier !== "GH-42",
          );
          if (!withUrl) {
            const row = result.structuredContent.rows.find(
              (row: { issueIdentifier: string }) =>
                row.issueIdentifier === "GH-42",
            );
            if (row) {
              row.issueUrl = null;
              row.lastMessage = "Runtime event. ".repeat(300);
            }
          }
        }
        return route.fulfill({ response, json: result });
      }
      return route.continue();
    });
    await open(page);
    const ui = app(page);
    await work(page, "GH-42", "GH-42").click();
    await expect(detail(page)).toContainText(
      withUrl ? "Paragraph 80." : "Runtime event.",
    );
    await detail(page).evaluate((element) => {
      element.scrollTop = 450;
      element.setAttribute("data-continuity", "same-detail");
    });
    await expect
      .poll(() => detail(page).evaluate((element) => element.scrollTop))
      .toBe(450);
    showNative = true;
    await ui
      .getByRole("button", { name: "Refresh Symphony", exact: true })
      .click();
    await expect(work(page, "GH-42", githubTitle)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(detail(page)).toContainText("Paragraph 80.");
    await expect(detail(page)).toHaveAttribute(
      "data-continuity",
      "same-detail",
    );
    if (withUrl)
      await expect
        .poll(() => detail(page).evaluate((element) => element.scrollTop))
        .toBe(450);
    else
      await expect
        .poll(() => detail(page).evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
    const position = await detail(page).evaluate(
      (element) => element.scrollTop,
    );
    await detail(page)
      .getByRole("button", { name: "Open issue", exact: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    await ui
      .getByRole("region", { name: "Symphony run", exact: true })
      .getByRole("button", { name: "View run", exact: true })
      .click();
    await expect(detail(page)).toContainText("Paragraph 80.");
    await expect
      .poll(() => detail(page).evaluate((element) => element.scrollTop))
      .toBe(position);
    running = false;
    await ui
      .getByRole("button", { name: "Refresh Symphony", exact: true })
      .click();
    await expect(work(page, "GH-42", githubTitle)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(detail(page)).toContainText("No active run");
    await expect(detail(page)).not.toContainText(
      "This work is no longer in the current snapshot.",
    );
  });
}

test("a connection-only Symphony launch does not report a missing issue", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON();
    if (input.name !== "arco_open") return route.continue();
    const response = await route.fetch({
      postData: JSON.stringify({
        ...input,
        arguments: {
          ...input.arguments,
          symphony: { connectionId: githubConnection },
        },
      }),
    });
    return route.fulfill({ response });
  });
  await open(page);
  await expect(work(page, "GH-42", githubTitle)).toBeVisible();
  await expect(app(page).getByRole("status")).toHaveCount(0);
  await expect(detail(page)).toHaveCount(0);
});
