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

test("same-number runtime from another repository stays separate from the native issue", async ({
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
  await ui.getByRole("button", { name: "Table view", exact: true }).click();
  await expect(runtime).toHaveAttribute("aria-pressed", "true");
  await native.click();
  await expect(
    detail(page).getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
  await expect(detail(page)).toContainText("No active run");
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
