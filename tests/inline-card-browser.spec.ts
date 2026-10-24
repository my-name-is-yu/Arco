import { expect, test, type Locator, type Page } from "@playwright/test";
import type { IssueDetail } from "../src/shared/contracts";
import type { LinearIssue } from "../src/shared/linear";
import type { SettingsRecord } from "../src/shared/state";
import { choose, selectControl } from "./select-helpers";
import { sharedContextFromText } from "./shared-context-helpers";

type Source = "github" | "linear";
type ToolCall = { name: string; arguments: Record<string, unknown> };

const githubRepo = "yu/Arco";
const otherRepo = "yu/Other";
const linearScope = {
  connectionId: "default",
  workspaceId: "fixture-linear-workspace",
  teamId: "fixture-linear-team",
};
const otherTeam = "fixture-other-team";
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
const markdown = [
  "## Background",
  "The **preview** keeps [the source](https://example.com/issue) readable.",
  "- First acceptance item\n- Second acceptance item",
  "## Implementation details",
  ...Array.from(
    { length: 8 },
    (_, index) =>
      `Paragraph ${index + 1} describes the issue in enough detail to require scrolling. Keep the complete Markdown blocks readable inside the compact conversation card.`,
  ),
  "Final paragraph remains available while scrolling the description.",
].join("\n\n");

const app = (page: Page) => page.frameLocator("#arco");
const issueRef = (source: Source, number: number) =>
  source === "github"
    ? { repo: githubRepo, number }
    : { ...linearScope, issueId: `fixture-linear-${number}` };

async function fixtureTool<T>(
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

async function createSession(page: Page) {
  const response = await page.request.post("/session");
  expect(response.ok()).toBe(true);
  const { session } = (await response.json()) as { session: string };
  const settings = await fixtureTool<SettingsRecord>(
    page,
    session,
    "arco_get_settings",
  );
  await fixtureTool(page, session, "arco_update_settings", {
    expectedRevision: settings.revision,
    patch: { githubRepos: [githubRepo, otherRepo] },
  });
  return session;
}

async function sourceIssue(
  page: Page,
  session: string,
  source: Source,
  number: number,
) {
  return fixtureTool<IssueDetail | LinearIssue>(
    page,
    session,
    source === "github" ? "arco_get_issue" : "linear_get_issue",
    issueRef(source, number),
  );
}

async function setIssueBody(
  page: Page,
  session: string,
  source: Source,
  body: string,
) {
  const issue = await sourceIssue(page, session, source, 42);
  return fixtureTool<IssueDetail | LinearIssue>(
    page,
    session,
    source === "github" ? "arco_update_issue" : "linear_update_issue",
    {
      ...issueRef(source, 42),
      requestId: crypto.randomUUID(),
      expectedUpdatedAt: issue.updatedAt,
      patch: { body },
    },
  );
}

async function openSource(page: Page, session: string, source: Source) {
  await page.goto(`/?entry=project&session=${session}`);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  if (source === "linear") await choose(app(page), "Issue source", "linear");
  await expect(
    app(page).getByRole("heading", { name: titles[source][0], exact: true }),
  ).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
}

async function events(page: Page, type: string) {
  const log = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  ) as { type: string; value: unknown }[];
  return log.filter((event) => event.type === type).map((event) => event.value);
}

async function decorationColor(
  visual: Locator,
  property: "color" | "backgroundColor" = "color",
) {
  await expect(visual).toBeVisible();
  await expect(visual).toHaveAttribute("aria-hidden", "true");
  return visual.evaluate(
    (element, property) => getComputedStyle(element)[property],
    property,
  );
}

// The fixture has one real repository/team. Expose a second browsing scope by
// adapting its reads only; every card mutation still reaches the real fixture.
async function addOtherBrowsingScope(page: Page, source: Source) {
  const reads = new Set(
    source === "github"
      ? [
          "arco_get_issue",
          "arco_list_issues",
          "arco_repo_metadata",
          "arco_comments",
          "arco_reactions",
          "arco_read_image",
        ]
      : [
          "linear_get_issue",
          "linear_list_issues",
          "linear_metadata",
          "linear_comments",
          "linear_read_image",
          "linear_templates",
        ],
  );
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolCall & {
      session: string;
    };
    const otherScope =
      source === "github"
        ? input.arguments.repo === otherRepo
        : input.arguments.teamId === otherTeam;
    if (source === "linear" && input.name === "linear_scopes") {
      const response = await route.fetch();
      const result = (await response.json()) as {
        structuredContent: { teams: Record<string, unknown>[] };
      };
      result.structuredContent.teams.push({
        id: otherTeam,
        name: "Other team",
        key: "OTHER",
      });
      return route.fulfill({ response, json: result });
    }
    if (!otherScope || !reads.has(input.name)) return route.fallback();
    const response = await route.fetch({
      postData: JSON.stringify({
        ...input,
        arguments: {
          ...input.arguments,
          ...(source === "github"
            ? { repo: githubRepo }
            : { teamId: linearScope.teamId }),
        },
      }),
    });
    if (
      ![
        "arco_get_issue",
        "arco_list_issues",
        "arco_repo_metadata",
        "linear_get_issue",
        "linear_list_issues",
        "linear_metadata",
      ].includes(input.name)
    )
      return route.fulfill({ response });
    const result = (await response.json()) as {
      isError?: boolean;
      structuredContent: Record<string, unknown>;
    };
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const data = result.structuredContent;
    if (input.name === "arco_repo_metadata") {
      data.assignees = ["fixture-user"];
      data.labels = (data.labels as { name: string }[]).filter(
        (label) => label.name !== "bug",
      );
    } else if (input.name === "linear_metadata") {
      data.members = (data.members as { id: string }[]).filter(
        (member) => member.id !== "fixture-linear-reviewer",
      );
      data.labels = (data.labels as { id: string }[]).filter(
        (label) => label.id !== "linear-label-bug",
      );
    } else {
      const rewrite = (issue: Record<string, unknown>) => {
        if (source === "github") {
          issue.repo = otherRepo;
          if (typeof issue.url === "string")
            issue.url = issue.url.replace(githubRepo, otherRepo);
        } else issue.teamId = otherTeam;
      };
      if (input.name.endsWith("get_issue")) rewrite(data);
      if (Array.isArray(data.issues)) data.issues.forEach(rewrite);
    }
    return route.fulfill({ response, json: result });
  });
}

for (const source of ["github", "linear"] as const) {
  test(`${source} inline Markdown scrolls immediately in a compact body and keeps properties above it at narrow widths`, async ({
    page,
  }) => {
    const session = await createSession(page);
    await setIssueBody(page, session, source, markdown);
    await openSource(page, session, source);
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    await page.setViewportSize({ width: 375, height: 900 });
    const ui = app(page);
    const card = ui.locator(".inline-mode");
    const description = card.locator(".inline-description");
    const content = description.getByRole("region", {
      name: "Issue description text",
      exact: true,
    });
    await expect(
      description.getByRole("heading", { name: "Background" }),
    ).toBeVisible();
    await expect(description.locator("strong")).toHaveText("preview");
    await expect(description).toContainText(
      "Final paragraph remains available while scrolling the description.",
    );
    await expect(content).toHaveAttribute("tabindex", "0");
    await expect(content).toHaveCSS("overflow-y", "auto");
    await expect(
      card.getByRole("button", { name: /^(Expand|Collapse) description$/ }),
    ).toHaveCount(0);
    const initial = await content.evaluate((element) => ({
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(initial.height).toBeGreaterThan(0);
    expect(initial.height).toBeLessThanOrEqual(191);
    expect(initial.scrollHeight).toBeGreaterThan(initial.height);
    await description
      .getByRole("button", { name: "the source", exact: true })
      .click();
    await expect
      .poll(() => events(page, "link"))
      .toEqual([{ url: "https://example.com/issue" }]);
    await expect(description.getByRole("listitem")).toHaveCount(2);
    const properties = card.locator(".inline-properties");
    const propertiesBounds = await properties.boundingBox();
    const bodyBounds = await description.boundingBox();
    expect(propertiesBounds!.y + propertiesBounds!.height).toBeLessThanOrEqual(
      bodyBounds!.y + 1,
    );
    await expect(
      card.getByRole("button", { name: "Open details", exact: true }),
    ).toBeVisible();
    await expect(
      selectControl(
        card,
        source === "github" ? "Assignees" : "Linear assignee",
      ),
    ).toBeVisible();
    await expect(selectControl(card, "Labels")).toBeVisible();
    const cardHeight = (await card.boundingBox())!.height;
    await content.focus();
    const documentTop = await ui
      .locator("html")
      .evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    await content.press("End");
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(
      content.getByText(
        "Final paragraph remains available while scrolling the description.",
        { exact: true },
      ),
    ).toBeInViewport();
    expect((await card.boundingBox())!.height).toBe(cardHeight);
    expect(
      await ui
        .locator("html")
        .evaluate(() => document.scrollingElement?.scrollTop ?? 0),
    ).toBe(documentTop);
    const layout = await card.evaluate((element) => ({
      documentWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      bounds: [
        element,
        ...element.querySelectorAll(
          ".inline-properties, .inline-description, .inline-description-content",
        ),
      ].map((node) => {
        const bounds = node.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right };
      }),
    }));
    expect(layout.contentWidth).toBeLessThanOrEqual(layout.documentWidth + 1);
    for (const bounds of layout.bounds) {
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(layout.documentWidth + 1);
    }
    expect(await events(page, "message")).toEqual([]);
  });

  test(`${source} short inline descriptions keep their natural height`, async ({
    page,
  }) => {
    const session = await createSession(page);
    await setIssueBody(
      page,
      session,
      source,
      "A short description stays compact.",
    );
    await openSource(page, session, source);
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    const card = app(page).locator(".inline-mode");
    const content = card.getByRole("region", {
      name: "Issue description text",
      exact: true,
    });
    await expect(content).toHaveText("A short description stays compact.");
    const bounds = await content.evaluate((element) => ({
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(bounds.height).toBeLessThan(100);
    expect(bounds.scrollHeight).toBe(bounds.height);
    await expect(card.locator(".inline-description-toggle")).toHaveCount(0);
  });

  test(`${source} inline assignee and labels update the retained issue using its own repository or team choices`, async ({
    page,
  }) => {
    const session = await createSession(page);
    const browsingBefore = await sourceIssue(page, session, source, 43);
    await addOtherBrowsingScope(page, source);
    await openSource(page, session, source);
    const ui = app(page);
    await ui.getByRole("button", { name: "Add to chat", exact: true }).click();
    await expect.poll(() => events(page, "context")).toHaveLength(1);
    await choose(
      ui,
      source === "github" ? "GitHub scope" : "Linear Team",
      source === "github" ? otherRepo : otherTeam,
    );
    await ui
      .locator(".issue-row")
      .filter({ hasText: titles[source][1] })
      .click();
    await expect(
      ui.getByRole("heading", { name: titles[source][1], exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    const card = ui.locator(".inline-mode");
    await expect(
      card.getByRole("heading", { name: titles[source][0], exact: true }),
    ).toBeVisible();
    await expect(card.locator(".compact-bottom")).toHaveCount(0);
    const assignee = selectControl(
      card,
      source === "github" ? "Assignees" : "Linear assignee",
    );
    if (source === "github") {
      await assignee.getByRole("button").click();
      await ui
        .getByRole("option", { name: "fixture-reviewer", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(assignee.getByRole("button")).toHaveAccessibleName(
        /^fixture-user(?: \(you\))? \+1$/,
      );
      await expect(assignee.locator(".source-multi-values")).toHaveAttribute(
        "title",
        /^fixture-user(?: \(you\))?, fixture-reviewer$/,
      );
    } else {
      await choose(card, "Linear assignee", "fixture-linear-reviewer");
      await expect(assignee).toContainText("Fixture reviewer");
    }
    const labels = selectControl(card, "Labels");
    await labels.getByRole("button").click();
    await ui
      .getByRole("option", {
        name: source === "github" ? "bug" : "Bug · workspace",
        exact: true,
      })
      .click();
    await page.keyboard.press("Escape");
    await expect(labels.locator(".source-multi-values")).toContainText(
      source === "github" ? "+2" : "+1",
    );
    await expect(labels.locator(".source-multi-values")).toHaveAttribute(
      "title",
      source === "github" ? /(?:^|, )bug(?:,|$)/ : /Bug · workspace/,
    );

    const saved = await sourceIssue(page, session, source, 42);
    if (saved.source === "github") {
      expect(saved.assignees).toEqual(["fixture-user", "fixture-reviewer"]);
      expect(saved.labels.map((label) => label.name)).toContain("bug");
    } else {
      expect(saved.assignee?.id).toBe("fixture-linear-reviewer");
      expect(saved.labels.map((label) => label.id)).toContain(
        "linear-label-bug",
      );
    }
    const browsingAfter = await sourceIssue(page, session, source, 43);
    expect(browsingAfter).toEqual(browsingBefore);
    const writes = ((await events(page, "tool")) as ToolCall[]).filter((call) =>
      [
        source === "github" ? "arco_update_issue" : "linear_update_issue",
        source === "github" ? "arco_change_labels" : "linear_change_labels",
      ].includes(call.name),
    );
    expect(writes).toHaveLength(2);
    for (const write of writes)
      expect(write.arguments).toMatchObject(issueRef(source, 42));
    expect(await events(page, "context")).toHaveLength(1);
    expect(await events(page, "message")).toEqual([]);
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}

test("focusing a late link scrolls the complete description without enlarging the card", async ({
  page,
}) => {
  const session = await createSession(page);
  await setIssueBody(
    page,
    session,
    "github",
    `${"A long paragraph keeps the same Markdown block while adding enough text to extend below the compact reading area. ".repeat(60)}[late source](https://example.com/late)`,
  );
  await openSource(page, session, "github");
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  const card = app(page).locator(".inline-mode");
  const content = card.getByRole("region", {
    name: "Issue description text",
    exact: true,
  });
  const lateSource = content.getByRole("button", {
    name: "late source",
    exact: true,
  });
  const cardHeight = (await card.boundingBox())!.height;
  const clipped = await lateSource.evaluate((element) => {
    const content = element.closest(".inline-description-content")!;
    return {
      linkTop: element.getBoundingClientRect().top,
      contentBottom: content.getBoundingClientRect().bottom,
      scrollTop: content.scrollTop,
    };
  });
  expect(clipped.linkTop).toBeGreaterThan(clipped.contentBottom);
  expect(clipped.scrollTop).toBe(0);

  await lateSource.focus();

  await expect(lateSource).toBeFocused();
  await expect(lateSource).toBeInViewport();
  await expect
    .poll(() => content.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect((await card.boundingBox())!.height).toBe(cardHeight);
  await expect(card.locator(".inline-description-toggle")).toHaveCount(0);
  expect(await events(page, "link")).toEqual([]);
});

test("closing and reopening a browsing GitHub card preserves its target and independent Project Status", async ({
  page,
}) => {
  const session = await createSession(page);
  const before = (await sourceIssue(
    page,
    session,
    "github",
    42,
  )) as IssueDetail;
  await openSource(page, session, "github");
  const reads = ((await events(page, "tool")) as ToolCall[]).filter(
    (call) => call.name === "arco_list_issues",
  );
  expect(reads.at(-1)?.arguments.state).toBe("open");
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  const card = app(page).locator(".inline-mode");
  const state = selectControl(card, "Change issue state");
  await choose(card, "Change issue state", "not_planned");
  await expect(state).toHaveAttribute("data-value", "not_planned");
  await expect(
    card.getByRole("heading", { name: titles.github[0], exact: true }),
  ).toBeVisible();
  const closed = (await sourceIssue(
    page,
    session,
    "github",
    42,
  )) as IssueDetail;
  expect(closed.state).toBe("closed");
  expect(closed.stateReason).toBe("not_planned");
  expect(closed.projects).toEqual(before.projects);

  await choose(card, "Change issue state", "open");
  await expect(state).toHaveAttribute("data-value", "open");
  const reopened = (await sourceIssue(
    page,
    session,
    "github",
    42,
  )) as IssueDetail;
  expect(reopened.state).toBe("open");
  expect(reopened.stateReason).toBe("reopened");
  expect(reopened.projects).toEqual(before.projects);
  await expect(
    card.getByRole("heading", { name: titles.github[0], exact: true }),
  ).toBeVisible();
  const writes = ((await events(page, "tool")) as ToolCall[]).filter(
    (call) => call.name === "arco_update_issue",
  );
  expect(writes.map((call) => call.arguments.patch)).toEqual([
    { state: "closed", stateReason: "not_planned" },
    { state: "open", stateReason: "reopened" },
  ]);
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
});

test("Linear inline workflow and priority save native values without changing the issue or project", async ({
  page,
}) => {
  const session = await createSession(page);
  const before = (await sourceIssue(
    page,
    session,
    "linear",
    42,
  )) as LinearIssue;
  await openSource(page, session, "linear");
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  const card = app(page).locator(".inline-mode");
  await choose(card, "Linear Workflow state", "linear-state-done");
  await expect(selectControl(card, "Linear Workflow state")).toHaveAttribute(
    "data-value",
    "linear-state-done",
  );
  await choose(card, "Linear Priority", "1");
  await expect(selectControl(card, "Linear Priority")).toHaveAttribute(
    "data-value",
    "1",
  );
  const saved = (await sourceIssue(page, session, "linear", 42)) as LinearIssue;
  expect(saved.state).toMatchObject({
    id: "linear-state-done",
    name: "Done",
    type: "completed",
  });
  expect(saved.priority).toBe(1);
  expect(saved.project).toEqual(before.project);
  await expect(
    card.getByRole("heading", { name: titles.linear[0], exact: true }),
  ).toBeVisible();
  const writes = ((await events(page, "tool")) as ToolCall[]).filter(
    (call) => call.name === "linear_update_issue",
  );
  expect(writes.map((call) => call.arguments.patch)).toEqual([
    { stateId: "linear-state-done" },
    { priority: 1 },
  ]);
  for (const write of writes)
    expect(write.arguments).toMatchObject(issueRef("linear", 42));
  expect(await events(page, "message")).toEqual([]);
});

test("inline tasks change only their source checkbox throughout the scrollable body for both providers", async ({
  page,
}) => {
  const body = [
    "[reference]: https://example.com/reference",
    "",
    "## Checklist",
    "",
    "- [ ] First inline task",
    "- [x] Existing inline task",
    "",
    "Context remains untouched with [the source][reference].",
    "",
    "## Later checklist",
    "",
    "- [ ] Later inline task",
    "",
    "Keep this final paragraph unchanged.",
    "",
  ].join("\r\n");
  for (const source of ["github", "linear"] as const) {
    const session = await createSession(page);
    const seeded = await setIssueBody(page, session, source, body);
    await openSource(page, session, source);
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    const card = app(page).locator(".inline-mode");
    const first = card.getByRole("checkbox", {
      name: "Completion of First inline task",
      exact: true,
    });
    await first.click();
    await expect(first).toBeChecked();
    const firstSaved = await sourceIssue(page, session, source, 42);
    const firstBody = body.replace(
      "[ ] First inline task",
      "[x] First inline task",
    );
    expect(firstSaved.body).toBe(firstBody);
    const later = card.getByRole("checkbox", {
      name: "Completion of Later inline task",
      exact: true,
    });
    await later.click();
    await expect(later).toBeChecked();
    const saved = await sourceIssue(page, session, source, 42);
    const finalBody = firstBody.replace(
      "[ ] Later inline task",
      "[x] Later inline task",
    );
    expect(saved.body).toBe(finalBody);
    expect(saved.state).toEqual(seeded.state);
    const writes = ((await events(page, "tool")) as ToolCall[]).filter(
      (call) =>
        call.name ===
        (source === "github" ? "arco_update_issue" : "linear_update_issue"),
    );
    expect(writes.map((call) => call.arguments.patch)).toEqual([
      { body: firstBody },
      { body: finalBody },
    ]);
    expect(writes[0]!.arguments.expectedUpdatedAt).toBe(seeded.updatedAt);
    expect(writes[1]!.arguments.expectedUpdatedAt).toBe(firstSaved.updatedAt);
    expect(await events(page, "message")).toEqual([]);
  }
});

test("a real stale GitHub update shows a conflict and keeps the card available for a refreshed retry", async ({
  page,
}) => {
  const session = await createSession(page);
  await openSource(page, session, "github");
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  const card = app(page).locator(".inline-mode");
  const externalBody =
    "An external update must survive the inline state change.";
  await setIssueBody(page, session, "github", externalBody);

  await choose(card, "Change issue state", "completed");

  await expect(card.getByRole("alert")).toContainText("changed elsewhere");
  await expect(selectControl(card, "Change issue state")).toHaveAttribute(
    "data-value",
    "open",
  );
  await expect(
    card.getByRole("heading", { name: titles.github[0], exact: true }),
  ).toBeVisible();
  await expect(card.locator(".inline-description")).toContainText(externalBody);
  const afterConflict = (await sourceIssue(
    page,
    session,
    "github",
    42,
  )) as IssueDetail;
  expect(afterConflict.state).toBe("open");
  expect(afterConflict.body).toBe(externalBody);

  await choose(card, "Change issue state", "completed");
  await expect(selectControl(card, "Change issue state")).toHaveAttribute(
    "data-value",
    "completed",
  );
  const saved = (await sourceIssue(page, session, "github", 42)) as IssueDetail;
  expect(saved.state).toBe("closed");
  expect(saved.stateReason).toBe("completed");
  expect(saved.body).toBe(externalBody);
  expect(await events(page, "message")).toEqual([]);
});

test("inline utilities copy the native identifier and URL and open the provider without sending a message", async ({
  page,
}) => {
  for (const source of ["github", "linear"] as const) {
    const session = await createSession(page);
    const issue = await sourceIssue(page, session, source, 42);
    await openSource(page, session, source);
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    const ui = app(page);
    const card = ui.locator(".inline-mode");
    await ui.locator("body").evaluate(() => {
      const values: string[] = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            values.push(value);
            document.documentElement.dataset.inlineCopies =
              JSON.stringify(values);
          },
        },
      });
    });
    const actions = card.getByLabel("Issue actions", { exact: true });
    const menu = actions.locator("..");
    await actions.click();
    await card.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(ui.locator("html")).toHaveAttribute(
      "data-inline-copies",
      JSON.stringify([issue.url]),
    );
    expect(await menu.getAttribute("open")).toBeNull();
    await expect(actions).toBeFocused();
    await actions.click();
    await card
      .getByRole("button", { name: "Copy issue ID", exact: true })
      .click();
    await expect(ui.locator("html")).toHaveAttribute(
      "data-inline-copies",
      JSON.stringify([issue.url, source === "github" ? "yu/Arco#42" : "YU-42"]),
    );
    await actions.click();
    await card
      .getByRole("button", {
        name: source === "github" ? "Open on GitHub" : "Open in Linear",
        exact: true,
      })
      .click();
    await expect.poll(() => events(page, "link")).toEqual([{ url: issue.url }]);
    await expect(
      card.getByRole("heading", { name: titles[source][0], exact: true }),
    ).toBeVisible();
    expect(await events(page, "context")).toEqual([]);
    expect(await events(page, "message")).toEqual([]);
  }
});

test("an unsaved GitHub description draft blocks inline tasks and remains available in details", async ({
  page,
}) => {
  const session = await createSession(page);
  const before = await sourceIssue(page, session, "github", 42);
  await openSource(page, session, "github");
  const ui = app(page);
  await ui.getByLabel("Issue actions", { exact: true }).click();
  await ui.getByRole("button", { name: "Edit issue", exact: true }).click();
  const draft = "An unsaved description must remain available.";
  await ui
    .getByRole("textbox", { name: "Issue body", exact: true })
    .fill(draft);
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  const card = ui.locator(".inline-mode");

  await card
    .getByRole("checkbox", {
      name: "Completion of Preserve filters, selection, and scroll position",
      exact: true,
    })
    .click();

  await expect(card.getByRole("status")).toContainText(
    "save or discard your title or description draft",
  );
  expect((await sourceIssue(page, session, "github", 42)).body).toBe(
    before.body,
  );
  const writes = ((await events(page, "tool")) as ToolCall[]).filter(
    (call) => call.name === "arco_update_issue",
  );
  expect(writes).toEqual([]);
  await card.getByRole("button", { name: "Open details", exact: true }).click();
  await ui.getByLabel("Issue actions", { exact: true }).click();
  await ui.getByRole("button", { name: "Edit issue", exact: true }).click();
  await expect(
    ui.getByRole("textbox", { name: "Issue body", exact: true }),
  ).toHaveValue(draft);
  expect(await events(page, "message")).toEqual([]);
});

test.describe("inline utility dismissal", () => {
  test.use({ hasTouch: true });

  test("card clicks, keyboard focus and host taps outside the menu dismiss it while preserving the destination focus", async ({
    page,
  }) => {
    for (const source of ["github", "linear"] as const) {
      const session = await createSession(page);
      const issue = await sourceIssue(page, session, source, 42);
      await openSource(page, session, source);
      await page
        .getByRole("button", { name: "Mock inline", exact: true })
        .click();
      const ui = app(page);
      const card = ui.locator(".inline-mode");
      await ui.locator("body").evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async () => {
              throw new Error("Fixture clipboard denied");
            },
          },
        });
      });
      const actions = card.getByLabel("Issue actions", { exact: true });
      const menu = actions.locator("..");
      await actions.click();
      await card
        .getByRole("button", { name: "Copy link", exact: true })
        .click();
      const manualCopy = card.getByRole("textbox", {
        name: "Value to copy",
        exact: true,
      });
      await expect(manualCopy).toHaveValue(issue.url);
      await expect(manualCopy).toBeFocused();
      await manualCopy.click();
      await expect(menu).toHaveJSProperty("open", true);

      const description = card.getByRole("region", {
        name: "Issue description text",
        exact: true,
      });
      await description.click({ position: { x: 3, y: 3 } });

      await expect(menu).toHaveJSProperty("open", false);
      await expect(description).toBeFocused();
      await actions.click();
      await expect(menu).toHaveJSProperty("open", true);
      await card
        .getByRole("button", {
          name: source === "github" ? "Open on GitHub" : "Open in Linear",
          exact: true,
        })
        .press("Tab");
      await expect(menu).toHaveJSProperty("open", false);
      await expect(
        selectControl(
          card,
          source === "github" ? "Change issue state" : "Linear Workflow state",
        ).getByRole("button"),
      ).toBeFocused();
      await actions.click();
      await expect(menu).toHaveJSProperty("open", true);
      const hostInput = page.getByRole("textbox", {
        name: "Mock @Arco search",
        exact: true,
      });

      await hostInput.tap();

      await expect(menu).toHaveJSProperty("open", false);
      await expect(hostInput).toBeFocused();
      await actions.click();
      await manualCopy.focus();
      await manualCopy.press("Escape");
      await expect(menu).toHaveJSProperty("open", false);
      await expect(actions).toBeFocused();

      await ui.locator("body").evaluate(() => {
        const pendingCopy = new Promise<void>((resolve) => {
          document.addEventListener("fixture-copy-complete", () => resolve(), {
            once: true,
          });
        });
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: () => pendingCopy },
        });
      });
      await actions.click();
      const identifierCopy = card.locator(".copy-value").nth(1);
      await identifierCopy
        .getByRole("button", { name: "Copy issue ID", exact: true })
        .click();
      await description.focus();
      await expect(menu).toHaveJSProperty("open", false);
      await expect(description).toBeFocused();

      await ui.locator("body").evaluate(() => {
        document.dispatchEvent(new Event("fixture-copy-complete"));
      });

      await expect(identifierCopy.locator("button")).toHaveText("Copied");
      await expect(menu).toHaveJSProperty("open", false);
      await expect(description).toBeFocused();
      expect(await events(page, "context")).toEqual([]);
      expect(await events(page, "message")).toEqual([]);
    }
  });
});

test("GitHub inline property visuals match their menu choices and retain native state and label actions", async ({
  page,
}) => {
  const session = await createSession(page);
  await openSource(page, session, "github");
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  const ui = app(page);
  const card = ui.locator(".inline-mode");
  const state = selectControl(card, "Change issue state");
  await expect(state).toHaveAccessibleName("Change issue state");
  const stateIcon = state.locator("svg.property-state-icon");
  await expect(stateIcon).toHaveAttribute("data-state", "open");
  const openColor = await decorationColor(stateIcon);
  await state.getByRole("button").click();
  const open = ui.getByRole("option", { name: "Open", exact: true });
  expect(await decorationColor(open.locator("svg.property-state-icon"))).toBe(
    openColor,
  );
  const completed = ui.getByRole("option", {
    name: "Closed · Completed",
    exact: true,
  });
  const completedColor = await decorationColor(
    completed.locator("svg.property-state-icon"),
  );
  expect(completedColor).not.toBe(openColor);
  await completed.click();
  await expect(state).toHaveAttribute("data-value", "completed");
  await expect(stateIcon).toHaveAttribute("data-state", "completed");
  expect(await decorationColor(stateIcon)).toBe(completedColor);

  const assignees = selectControl(card, "Assignees");
  await expect(assignees.getByRole("button")).toHaveAccessibleName(
    "fixture-user (you)",
  );
  const initials = assignees.locator(".property-assignee-mark");
  await decorationColor(initials);
  await expect(initials).toHaveText(/\S/);
  await assignees.getByRole("button").click();
  const self = ui.getByRole("option", {
    name: "fixture-user (you)",
    exact: true,
  });
  await decorationColor(self.locator(".property-assignee-mark"));
  await page.keyboard.press("Escape");

  const labels = selectControl(card, "Labels");
  await expect(labels.getByRole("button")).toHaveAccessibleName(
    "enhancement +1",
  );
  const labelDot = labels.locator(".property-label-dot");
  expect(await decorationColor(labelDot, "backgroundColor")).toBe(
    "rgb(162, 238, 239)",
  );
  await labels.getByRole("button").click();
  const enhancement = ui.getByRole("option", {
    name: "enhancement",
    exact: true,
  });
  expect(
    await decorationColor(
      enhancement.locator(".property-label-dot"),
      "backgroundColor",
    ),
  ).toBe("rgb(162, 238, 239)");
  await enhancement.click();
  await page.keyboard.press("Escape");
  await expect(labels.getByRole("button")).toHaveAccessibleName("design");
  expect(await decorationColor(labelDot, "backgroundColor")).toBe(
    "rgb(197, 222, 245)",
  );
  const saved = (await sourceIssue(page, session, "github", 42)) as IssueDetail;
  expect(saved.state).toBe("closed");
  expect(saved.stateReason).toBe("completed");
  expect(saved.labels.map((label) => label.name)).toEqual(["design"]);
  expect(await events(page, "message")).toEqual([]);
});

test("Linear inline visuals preserve source workflow colors, neutral assignees and Urgent priority actions", async ({
  page,
}) => {
  const session = await createSession(page);
  await openSource(page, session, "linear");
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  const ui = app(page);
  const card = ui.locator(".inline-mode");
  const state = selectControl(card, "Linear Workflow state");
  await expect(state).toHaveAccessibleName("Linear Workflow state");
  const stateIcon = state.locator("svg.property-state-icon");
  await expect(stateIcon).toHaveAttribute("data-state", "started");
  expect(await decorationColor(stateIcon)).toBe("rgb(242, 201, 76)");
  await state.getByRole("button").click();
  const inProgress = ui.getByRole("option", {
    name: "In Progress",
    exact: true,
  });
  expect(
    await decorationColor(inProgress.locator("svg.property-state-icon")),
  ).toBe("rgb(242, 201, 76)");
  const done = ui.getByRole("option", { name: "Done", exact: true });
  await expect(done.locator("svg.property-state-icon")).toHaveAttribute(
    "data-state",
    "completed",
  );
  const doneColor = await decorationColor(
    done.locator("svg.property-state-icon"),
  );
  await done.click();
  await expect(state).toHaveAttribute("data-value", "linear-state-done");
  expect(await decorationColor(stateIcon)).toBe(doneColor);

  const assignee = selectControl(card, "Linear assignee");
  await decorationColor(assignee.locator(".property-assignee-mark"));
  await assignee.getByRole("button").click();
  const self = ui.getByRole("option", {
    name: "Fixture user (you)",
    exact: true,
  });
  await decorationColor(self.locator(".property-assignee-mark"));
  const unassigned = ui.getByRole("option", {
    name: "Unassigned",
    exact: true,
  });
  const neutralColor = await decorationColor(
    unassigned.locator("svg.property-assignee-unassigned"),
  );
  await unassigned.click();
  await expect(assignee).toHaveAttribute("data-value", "");
  expect(
    await decorationColor(assignee.locator("svg.property-assignee-unassigned")),
  ).toBe(neutralColor);

  const priority = selectControl(card, "Linear Priority");
  const priorityIcon = priority.locator("svg.property-priority-icon");
  await expect(priorityIcon).toHaveAttribute("data-priority", "2");
  await decorationColor(priorityIcon);
  await priority.getByRole("button").click();
  const urgent = ui.getByRole("option", { name: "Urgent", exact: true });
  const urgentColor = await decorationColor(
    urgent.locator("svg.property-priority-icon"),
  );
  expect(urgentColor).not.toBe(neutralColor);
  await urgent.click();
  await expect(priority).toHaveAttribute("data-value", "1");
  await expect(priorityIcon).toHaveAttribute("data-priority", "1");
  expect(await decorationColor(priorityIcon)).toBe(urgentColor);

  const labels = selectControl(card, "Labels");
  const labelColor = await decorationColor(
    labels.locator(".property-label-dot"),
    "backgroundColor",
  );
  expect(labelColor).toBe("rgb(197, 222, 245)");
  await labels.getByRole("button").click();
  expect(
    await decorationColor(
      ui
        .getByRole("option", { name: "Design", exact: true })
        .locator(".property-label-dot"),
      "backgroundColor",
    ),
  ).toBe(labelColor);
  await page.keyboard.press("Escape");
  const saved = (await sourceIssue(page, session, "linear", 42)) as LinearIssue;
  expect(saved.state.id).toBe("linear-state-done");
  expect(saved.assignee).toBeNull();
  expect(saved.priority).toBe(1);
  expect(await events(page, "message")).toEqual([]);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.evaluate(() => {
    document
      .querySelector<HTMLIFrameElement>("#arco")!
      .contentWindow!.postMessage(
        {
          jsonrpc: "2.0",
          method: "ui/notifications/host-context-changed",
          params: { theme: "light" },
        },
        "*",
      );
  });
  await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await card.screenshot({
    path: "test-results/colors-light-narrow.png",
  });
});

test("invalid source colors stay neutral and inline property menus fit 375px in dark and light themes", async ({
  page,
}) => {
  const invalidColor =
    "#ff0000;position:fixed;background:url(https://example.com/injected)";
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolCall;
    if (
      ![
        "arco_get_issue",
        "arco_repo_metadata",
        "linear_get_issue",
        "linear_metadata",
      ].includes(input.name)
    )
      return route.fallback();
    const response = await route.fetch();
    const result = (await response.json()) as {
      isError?: boolean;
      structuredContent: {
        labels?: { color: string }[];
        state?: { color: string };
        states?: { color: string }[];
      };
    };
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const data = result.structuredContent;
    for (const label of data.labels ?? []) label.color = invalidColor;
    for (const state of data.states ?? []) state.color = invalidColor;
    if (typeof data.state === "object") data.state.color = invalidColor;
    return route.fulfill({ response, json: result });
  });
  for (const source of ["github", "linear"] as const) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const session = await createSession(page);
    await openSource(page, session, source);
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    await page.setViewportSize({ width: 375, height: 900 });
    const ui = app(page);
    const card = ui.locator(".inline-mode");
    for (const theme of ["dark", "light"] as const) {
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
      await expect(card).toHaveCSS(
        "background-color",
        theme === "dark" ? "rgb(25, 25, 25)" : "rgb(255, 255, 255)",
      );
      const neutral =
        theme === "dark" ? "rgb(176, 176, 176)" : "rgb(111, 111, 111)";
      const labels = selectControl(card, "Labels");
      const labelDot = labels.locator(".property-label-dot");
      expect(await decorationColor(labelDot, "backgroundColor")).toBe(neutral);
      expect(
        await labelDot.evaluate(
          (element) => (element as HTMLElement).style.backgroundColor,
        ),
      ).toBe("");
      await expect(labels.getByRole("button")).toHaveAccessibleName(
        source === "github" ? "enhancement +1" : "Design",
      );
      await labels.getByRole("button").click();
      const option = ui.getByRole("option", {
        name: source === "github" ? "enhancement" : "Design",
        exact: true,
      });
      expect(
        await decorationColor(
          option.locator(".property-label-dot"),
          "backgroundColor",
        ),
      ).toBe(neutral);
      const popup = ui.getByRole("dialog");
      const bounds = await popup.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(376);
      await page.keyboard.press("Escape");
      if (source === "linear") {
        const state = selectControl(card, "Linear Workflow state");
        const icon = state.locator("svg.property-state-icon");
        expect(await decorationColor(icon)).toBe(neutral);
        expect(
          await icon.evaluate((element) => (element as SVGElement).style.color),
        ).toBe("");
        await expect(icon).toHaveAttribute("data-state", "started");
        await state.getByRole("button").click();
        expect(
          await decorationColor(
            ui
              .getByRole("option", { name: "In Progress", exact: true })
              .locator("svg.property-state-icon"),
          ),
        ).toBe(neutral);
        await page.keyboard.press("Escape");
      }
      const layout = await card.evaluate((element) => ({
        width: document.documentElement.clientWidth,
        contentWidth: document.documentElement.scrollWidth,
        controls: Array.from(
          element.querySelectorAll(".inline-properties [role=group]"),
          (control) => {
            const bounds = control.getBoundingClientRect();
            return { left: bounds.left, right: bounds.right };
          },
        ),
      }));
      expect(layout.contentWidth).toBeLessThanOrEqual(layout.width + 1);
      for (const control of layout.controls) {
        expect(control.left).toBeGreaterThanOrEqual(0);
        expect(control.right).toBeLessThanOrEqual(layout.width + 1);
      }
    }
    expect(await events(page, "message")).toEqual([]);
  }
});

type InlineMotionSample = {
  target: "card" | "description";
  phase: "start" | "end";
  name: string;
  duration: number;
  opacity: number;
  transform: string;
  translate: string;
};

async function observeInlineMotion(card: Locator) {
  await card.evaluate(async (element) => {
    await Promise.allSettled(
      element.getAnimations().map((item) => item.finished),
    );
    // Finished promises resolve before the queued animationend event is delivered.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const samples: InlineMotionSample[] = [];
    const record = (event: AnimationEvent, phase: "start" | "end") => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const kind =
        target === element
          ? "card"
          : target.matches(".inline-description-content")
            ? "description"
            : null;
      if (!kind) return;
      const style = getComputedStyle(target);
      samples.push({
        target: kind,
        phase,
        name: event.animationName,
        duration: Number.parseFloat(style.animationDuration) * 1000,
        opacity: Number(style.opacity),
        transform: style.transform,
        translate: style.translate,
      });
      element.setAttribute("data-motion-samples", JSON.stringify(samples));
    };
    element.setAttribute("data-motion-samples", "[]");
    element.addEventListener("animationstart", (event) => {
      if (event instanceof AnimationEvent) record(event, "start");
    });
    element.addEventListener("animationend", (event) => {
      if (event instanceof AnimationEvent) record(event, "end");
    });
  });
}

async function inlineMotionSamples(card: Locator) {
  return JSON.parse(
    (await card.getAttribute("data-motion-samples")) ?? "[]",
  ) as InlineMotionSample[];
}

for (const source of ["github", "linear"] as const) {
  test(`${source} inline body scrolling keeps reading surfaces still and respects reduced motion`, async ({
    page,
  }) => {
    const session = await createSession(page);
    await setIssueBody(page, session, source, markdown);
    await openSource(page, session, source);
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    await page.setViewportSize({ width: 375, height: 900 });
    const ui = app(page);
    const card = ui.locator(".inline-issue-card");
    await observeInlineMotion(card);

    const open = card.getByRole("button", {
      name: "Open details",
      exact: true,
    });
    await open.hover();
    await expect(open).toHaveCSS("scale", "1.04");
    expect(
      await open.evaluate(
        (element) => getComputedStyle(element).transitionDuration,
      ),
    ).toContain("0.15s");
    const stateLabel =
      source === "github" ? "Change issue state" : "Linear Workflow state";
    const state = selectControl(card, stateLabel);
    await state.getByRole("button").hover();
    expect(
      await state.getByRole("button").evaluate((element) => {
        const scale = getComputedStyle(element).scale;
        return scale === "none" ? 1 : Number(scale);
      }),
    ).toBe(1);

    const content = card.getByRole("region", {
      name: "Issue description text",
      exact: true,
    });
    await content.focus();
    await content.press("End");
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(content).toHaveCSS("animation-name", "none");
    await expect(content).toHaveCSS("opacity", "1");
    await expect(content).toHaveCSS("transform", "none");
    await expect(content).toHaveCSS("translate", "none");
    expect(await inlineMotionSamples(card)).toEqual([]);
    await expect(card.locator(".inline-description-toggle")).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await open.hover();
    await expect(open).toHaveCSS("scale", "none");
    await expect(open).toHaveCSS("transition-duration", "0s");
    await content.focus();
    await content.press("Home");
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBe(0);
    await content.press("End");
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(content).toHaveCSS("animation-name", "none");
    await expect(content).toHaveCSS("opacity", "1");
    expect(await inlineMotionSamples(card)).toEqual([]);
    // Restoring motion can restart the card fade independently of scrolling.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(content).toHaveCSS("animation-name", "none");
    expect(await events(page, "message")).toEqual([]);
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}

for (const source of ["github", "linear"] as const) {
  test(`${source} ordinary inline saves, sharing, source links and detail navigation stay quiet`, async ({
    page,
  }) => {
    const session = await createSession(page);
    await openSource(page, session, source);
    const ui = app(page);
    await ui.getByRole("button", { name: "Add to chat", exact: true }).click();
    await expect.poll(() => events(page, "context")).toHaveLength(1);
    const shared = (await events(page, "context"))[0];
    const label = source === "github" ? "Arco #42" : "YU-42";
    expect(shared).toMatchObject({
      content: [
        {
          _meta: {
            "openai/title": label,
            "openai/group": { title: label },
          },
        },
        { _meta: { "openai/group": { title: label } } },
      ],
    });
    expect(sharedContextFromText(shared)).toMatchObject({
      source,
      title: titles[source][0],
    });
    await expect(ui.locator(".notice")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    const card = ui.locator(".inline-issue-card");
    const stateLabel =
      source === "github" ? "Change issue state" : "Linear Workflow state";
    const value = source === "github" ? "not_planned" : "linear-state-done";
    await choose(card, stateLabel, value);
    await expect(selectControl(card, stateLabel)).toHaveAttribute(
      "data-value",
      value,
    );
    await expect(card.locator(".notice")).toHaveCount(0);
    await card.getByLabel("Issue actions", { exact: true }).click();
    await card
      .getByRole("button", {
        name: source === "github" ? "Open on GitHub" : "Open in Linear",
        exact: true,
      })
      .click();
    await expect.poll(() => events(page, "link")).toHaveLength(1);
    await expect(card.locator(".notice")).toHaveCount(0);
    await card
      .getByRole("button", { name: "Open details", exact: true })
      .click();
    await expect(ui.locator(".workspace")).toBeVisible();
    await expect(
      ui.getByRole("heading", { name: titles[source][0], exact: true }),
    ).toBeVisible();
    await expect(ui.locator(".notice")).toHaveCount(0);
    expect(await events(page, "message")).toEqual([]);
  });
}
