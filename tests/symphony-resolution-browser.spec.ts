import { expect, test, type Page } from "./browser-test";
import type { SettingsRecord } from "../src/shared/state";
import type {
  SymphonyConnection,
  SymphonySnapshot,
} from "../src/shared/symphony";

const app = (page: Page) => page.frameLocator("#arco");
const githubTitle = "Preserve issue selection and scroll position";
const linearTitle = "Keep Linear workflow states intact";
const github: SymphonyConnection = {
  id: "fixture-symphony-github",
  name: "GitHub runtime",
  baseUrl: "https://symphony-fixture.invalid/github",
  binding: {
    source: "github",
    repo: "yu/Arco",
    prepareLabels: [],
    reviewLabels: [],
  },
};
const linear: SymphonyConnection = {
  id: "fixture-symphony-linear",
  name: "Linear runtime",
  baseUrl: "https://symphony-fixture.invalid/linear",
  binding: {
    source: "linear",
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-linear-team",
    prepareStateIds: [],
    reviewStateIds: [],
  },
};

async function tool<T>(
  page: Page,
  session: string,
  name: string,
  args: object = {},
): Promise<T> {
  const response = await page.request.post("/tool", {
    data: { session, name, arguments: args },
  });
  const result = await response.json();
  expect(result.isError).not.toBe(true);
  return result.structuredContent as T;
}
async function setup(page: Page, connection: SymphonyConnection) {
  const response = await page.request.post("/session");
  const { session } = (await response.json()) as { session: string };
  const saved = await tool<SettingsRecord>(page, session, "arco_get_settings");
  await tool(page, session, "arco_update_settings", {
    expectedRevision: saved.revision,
    patch: {
      activeSource: "symphony",
      symphonyConnections: [connection],
      activeSymphonyConnectionId: connection.id,
    },
  });
  return session;
}
async function open(page: Page, session: string, identifier: string) {
  await page.goto(`/?session=${session}&source=symphony`);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await app(page)
    .getByRole("button", { name: `${identifier}: ${identifier}`, exact: true })
    .click();
  return app(page).getByRole("complementary", {
    name: "Symphony work details",
  });
}

test("selected runtime resolves a closed GitHub issue absent from the open first page", async ({
  page,
}) => {
  const session = await setup(page, github);
  await tool(page, session, "arco_update_issue", {
    repo: "yu/Arco",
    number: 42,
    requestId: "close-for-runtime-context",
    patch: { state: "closed" },
  });
  const detail = await open(page, session, "GH-42");
  await expect(
    detail.getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
  await expect(detail).toContainText(
    "Return to the same position when switching between issues.",
  );
  await expect(detail.locator(".symphony-native-state")).toContainText(
    "Closed",
  );
  await detail
    .getByRole("button", { name: "Add run context to chat", exact: true })
    .click();
  await expect
    .poll(async () =>
      JSON.parse((await page.locator("#events").textContent()) ?? "[]").some(
        (event: { type: string; value: unknown }) =>
          event.type === "context" &&
          JSON.stringify(event.value).includes('"title":"' + githubTitle + '"'),
      ),
    )
    .toBe(true);
  await detail.getByRole("button", { name: "Open issue", exact: true }).click();
  await expect(
    app(page).getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
});

test("selected runtime resolves a Linear issue absent from the loaded first page", async ({
  page,
}) => {
  let resolved = false;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { query?: string };
    };
    if (input.name === "linear_resolve_issue") resolved = true;
    if (input.name !== "linear_list_issues" || input.arguments.query)
      return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    result.structuredContent.issues = result.structuredContent.issues.filter(
      (issue: { issueId: string }) => issue.issueId !== "fixture-linear-42",
    );
    return route.fulfill({ response, json: result });
  });
  const scoped = structuredClone(linear);
  if (scoped.binding?.source === "linear")
    scoped.binding.projectId = "linear-project";
  const detail = await open(page, await setup(page, scoped), "YU-42");
  await expect(
    detail.getByRole("heading", { name: linearTitle, exact: true }),
  ).toBeVisible();
  await expect(detail).toContainText("Keep GitHub Open/Closed separate");
  expect(resolved).toBe(true);
  await detail
    .getByRole("button", { name: "Add run context to chat", exact: true })
    .click();
  await expect
    .poll(async () =>
      JSON.parse((await page.locator("#events").textContent()) ?? "[]").some(
        (event: { type: string; value: unknown }) =>
          event.type === "context" &&
          JSON.stringify(event.value).includes(
            "https://linear.app/fixture/issue/YU-42",
          ),
      ),
    )
    .toBe(true);
  await expect(
    detail.getByRole("button", { name: "Open issue", exact: true }),
  ).toBeVisible();
});

test("canonical runtime from another GitHub repository does not read a native body", async ({
  page,
}) => {
  let bodyReads = 0;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "arco_get_issue") bodyReads++;
    if (input.name !== "arco_symphony_state") return route.continue();
    const response = await route.fetch();
    const result = (await response.json()) as {
      structuredContent: SymphonySnapshot;
    };
    result.structuredContent.rows.find(
      (row) => row.issueIdentifier === "GH-42",
    )!.issueUrl = "https://github.com/another/project/issues/42";
    return route.fulfill({ response, json: result });
  });
  const detail = await open(page, await setup(page, github), "GH-42");
  await expect(detail).toContainText("No linked issue in this scope.");
  await expect(
    detail.getByRole("button", { name: "Open issue", exact: true }),
  ).toHaveCount(0);
  expect(bodyReads).toBe(0);
});

for (const mismatch of ["team", "project"] as const) {
  test(`Linear runtime ${mismatch} mismatch is rejected before reading a native body`, async ({
    page,
  }) => {
    let resolutionFinished = false;
    let bodyReads = 0;
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      if (input.name === "linear_get_issue") bodyReads++;
      if (input.name === "linear_resolve_issue") {
        const response = await route.fetch();
        const result = await response.json();
        if (mismatch === "team")
          result.structuredContent.teamId = "another-team";
        resolutionFinished = true;
        return route.fulfill({ response, json: result });
      }
      if (input.name !== "linear_list_issues") return route.continue();
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.issues = [];
      return route.fulfill({ response, json: result });
    });
    const connection = structuredClone(linear);
    if (mismatch === "project" && connection.binding?.source === "linear")
      connection.binding.projectId = "another-project";
    const detail = await open(page, await setup(page, connection), "YU-42");
    await expect.poll(() => resolutionFinished).toBe(true);
    await expect(detail).toContainText("No linked issue in this scope.");
    await expect(
      detail.getByRole("button", { name: "Open issue", exact: true }),
    ).toHaveCount(0);
    expect(bodyReads).toBe(0);
  });
}
