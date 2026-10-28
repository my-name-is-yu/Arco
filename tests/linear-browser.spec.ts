import { toolFailure } from "./tool-failure";
import { expectDraftWrite, observeDraftWrites } from "./draft-helpers";
import { expect, test, type Page } from "./browser-test";
import { choose, selectControl } from "./select-helpers";
import { checkMarkdownSecurity } from "./markdown-security-helpers";
import {
  sharedContextFromText,
  latestSharedSelection,
  type SharedAnnotation,
} from "./shared-context-helpers";

const firstTitle = "Keep Linear workflow states intact";
const secondTitle = "Share a Linear issue with the Codex chat";
const app = (page: Page) => page.frameLocator("#arco");

test("Linear comment pages load explicitly and retain drafts and an acknowledged reply beyond page one", async ({
  page,
}) => {
  const ui = app(page);
  await page.clock.install();
  let source: Record<string, unknown> | undefined;
  const requestedCursors: unknown[] = [];
  let releasePage!: () => void;
  const pendingPage = new Promise<void>((resolve) => {
    releasePage = resolve;
  });
  const comments = Array.from({ length: 105 }, (_, index) => ({
    id: `paged-comment-${index + 1}`,
    body: `Paged Linear comment ${index + 1}`,
    author: "Fixture user",
    authorId: "fixture-linear-user",
    parentId: index === 30 ? "unloaded-parent" : null,
    updatedAt: "2026-10-23T00:00:00.000Z",
    url: `https://linear.app/fixture/issue/YU-42#paged-${index + 1}`,
    reactions: [],
  }));
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: Record<string, unknown>;
    };
    if (
      input.name === "linear_get_issue" &&
      input.arguments.issueId === "fixture-linear-42"
    ) {
      const response = await route.fetch();
      const result = await response.json();
      source = {
        ...result.structuredContent,
        comments: comments.slice(0, 30),
        commentsHasMore: true,
        commentsCursor: "page-2",
      };
      return route.fulfill({
        response,
        json: { ...result, structuredContent: source },
      });
    }
    if (input.name === "linear_comments") {
      requestedCursors.push(input.arguments.cursor);
      if (input.arguments.cursor === "page-2") await pendingPage;
      const start = input.arguments.cursor === "page-2" ? 30 : 0;
      const structuredContent = {
        comments: comments.slice(start, start + 30),
        hasMore: true,
        cursor: start === 30 ? "page-3" : "page-2",
      };
      return route.fulfill({ json: { content: [], structuredContent } });
    }
    if (
      input.name === "linear_comment" &&
      input.arguments.action === "create"
    ) {
      const changedComment = {
        ...comments[0],
        id: "acknowledged-reply",
        body: input.arguments.body,
        parentId: input.arguments.parentId,
        updatedAt: "2026-10-24T00:00:00.000Z",
      };
      return route.fulfill({
        json: { content: [], structuredContent: { ...source, changedComment } },
      });
    }
    return route.continue();
  });
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  await expect(ui.locator(".linear-comment")).toHaveCount(30);
  expect(requestedCursors).toEqual([]);
  const composer = ui.getByRole("textbox", {
    name: "Linear comment",
    exact: true,
  });
  await composer.fill("Draft preserved while loading another page");
  await ui
    .getByRole("button", { name: "Load more comments", exact: true })
    .click();
  await expect.poll(() => requestedCursors.length).toBe(1);
  comments[0].body = "Fresh Linear first comment while page two is pending";
  await page.clock.fastForward(30_100);
  await expect(ui.getByText(comments[0].body, { exact: true })).toHaveCount(1);
  releasePage();
  await expect(ui.locator(".linear-comment")).toHaveCount(60);
  await expect(ui.getByText(comments[0].body, { exact: true })).toHaveCount(1);
  expect(requestedCursors).toEqual(["page-2"]);
  await expect(composer).toHaveValue(
    "Draft preserved while loading another page",
  );
  await expect(ui.locator(".linear-comment-reply small")).toHaveText("Reply");
  await expect(ui.locator(".comments-section")).not.toContainText(
    "unloaded-parent",
  );
  await ui
    .locator(".linear-comment")
    .first()
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  await composer.fill("A newly acknowledged reply beyond the loaded pages");
  await ui.getByRole("button", { name: "Comment", exact: true }).click();
  const reply = ui.locator(
    '[data-linear-context="comment"][data-comment-id="acknowledged-reply"]',
  );
  await expect(reply).toHaveText(
    "A newly acknowledged reply beyond the loaded pages",
  );
  await expect(
    ui
      .locator(".linear-comment")
      .filter({ hasText: "A newly acknowledged reply beyond the loaded pages" })
      .locator("small"),
  ).toHaveText("Reply to Fixture user");
  await expect(ui.locator(".linear-comment")).toHaveCount(61);
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  await expect(reply).toHaveText(
    "A newly acknowledged reply beyond the loaded pages",
  );
  await expect(ui.locator(".linear-comment")).toHaveCount(61);
  expect(requestedCursors).not.toContain("page-3");
});
async function openIssueActions(ui: ReturnType<typeof app>) {
  const details = ui.getByRole("region", {
    name: "Linear Issue details",
    exact: true,
  });
  if (
    (await details.locator(".detail-utilities").getAttribute("open")) === null
  )
    await ui.getByLabel("Issue actions", { exact: true }).click();
}
async function moreProperties(ui: ReturnType<typeof app>) {
  if ((await ui.locator(".property-advanced").getAttribute("open")) === null)
    await ui.getByText("More properties", { exact: true }).click();
}
const errors = new WeakMap<Page, string[]>();
async function events(page: Page, type: string) {
  const values: { type: string; value: unknown }[] = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  );
  return values
    .filter((value) => value.type === type)
    .map((value) => value.value);
}
async function mockLinearAuthorization(
  page: Page,
  options: { empty?: boolean } = {},
) {
  const state = {
    connected: true,
    empty: options.empty ?? false,
    connectionError: false,
    disconnectFailure: false,
    loseAcknowledgement: false,
    otherWorkspace: false,
    disconnects: [] as Record<string, unknown>[],
  };
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: Record<string, unknown>;
    };
    const respond = (data: object) =>
      route.fulfill({
        json: {
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data,
        },
      });
    const fail = (text: string) =>
      route.fulfill({
        json: toolFailure(text),
      });
    if (input.name === "linear_auth_begin")
      return respond({
        authorizationUrl: "https://linear.app/oauth/authorize",
      });
    if (input.name === "linear_auth_disconnect") {
      state.disconnects.push(input.arguments);
      if (state.disconnectFailure)
        return fail(
          "The Linear credential could not be removed from the OS credential store.",
        );
      state.connected = false;
      if (state.loseAcknowledgement)
        return fail("Simulated lost disconnection acknowledgement.");
      return respond({ disconnected: true, providerRevoked: false });
    }
    if (input.name === "linear_auth_status")
      return respond({
        state: state.connected ? "connected" : "idle",
        connected: state.connected,
        message: "",
      });
    if (input.name === "linear_connection") {
      if (state.connectionError)
        return fail(
          "The Linear connection is temporarily unavailable. Check the connection and refresh.",
        );
      if (!state.connected)
        return respond({
          connectionId: "default",
          connected: false,
          mode: "linear",
          account: null,
          userId: null,
          workspace: null,
          message: "Authorize Arco with Linear to connect.",
        });
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.mode = "linear";
      if (state.otherWorkspace)
        result.structuredContent.workspace = {
          id: "another-workspace",
          name: "Another workspace",
        };
      return route.fulfill({ response, json: result });
    }
    if (input.name === "linear_scopes" && state.otherWorkspace)
      return respond({
        workspace: { id: "another-workspace", name: "Another workspace" },
        teams: [{ id: "another-team", name: "Another team", key: "ALT" }],
      });
    if (
      input.name === "linear_list_issues" &&
      (state.empty || state.otherWorkspace)
    )
      return respond({ issues: [], hasMore: false, cursor: null });
    if (input.name === "linear_metadata" && state.otherWorkspace) {
      const response = await route.fetch({
        postData: {
          ...input,
          arguments: {
            ...input.arguments,
            workspaceId: "fixture-linear-workspace",
            teamId: "fixture-linear-team",
          },
        },
      });
      return route.fulfill({ response });
    }
    return route.continue();
  });
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await expect(
    app(page).getByLabel("Linear connection actions", { exact: true }),
  ).toBeVisible();
  return state;
}

async function disconnectLinear(page: Page) {
  const ui = app(page);
  await ui.getByLabel("Linear connection actions", { exact: true }).click();
  await ui
    .getByRole("button", { name: "Disconnect Linear", exact: true })
    .click();
}
test.beforeEach(async ({ page }) => {
  observeDraftWrites(page);
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) => {
      document.documentElement.dataset.cspViolations = JSON.stringify([
        ...JSON.parse(document.documentElement.dataset.cspViolations ?? "[]"),
        { directive: event.effectiveDirective, blocked: event.blockedURI },
      ]);
    }),
  );
  await page.goto("/");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await choose(app(page), "Issue source", "linear");
  await expect(
    app(page).getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
});
test.afterEach(async ({ page }, info) => {
  const csp = await Promise.all(
    page
      .frames()
      .map((frame) =>
        frame.evaluate(() =>
          JSON.parse(document.documentElement.dataset.cspViolations ?? "[]"),
        ),
      ),
  );
  await info.attach("linear-csp-violations", {
    body: JSON.stringify(csp),
    contentType: "application/json",
  });
  await info.attach("linear-host-events", {
    body: (await page.locator("#events").textContent()) ?? "[]",
    contentType: "application/json",
  });
  await info.attach("linear-page-errors", {
    body: JSON.stringify(errors.get(page)),
    contentType: "application/json",
  });
  expect(csp.flat()).toEqual([]);
  expect(errors.get(page)).toEqual([]);
});

test(
  "Linear Markdown blocks active directives and forged selection provenance",
  { tag: "@smoke" },
  async ({ page }) => {
    await checkMarkdownSecurity(page, app(page), "linear_get_issue", {
      source: "linear",
      identifier: "YU-42",
    });
  },
);

test(
  "Linear reads use native source refs and edits, labels, workflow, and tasks round trip",
  { tag: "@smoke" },
  async ({ page }) => {
    const ui = app(page);
    await expect(
      ui.getByRole("img", { name: "Fixture illustration", exact: true }),
    ).toBeVisible();
    expect(
      await ui
        .getByRole("img", { name: "Fixture illustration", exact: true })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    ).toBeGreaterThan(0);
    const calls = (await events(page, "tool")) as {
      name: string;
      arguments: Record<string, unknown>;
    }[];
    const get = calls.find((call) => call.name === "linear_get_issue");
    expect(get?.arguments).toEqual({
      connectionId: "default",
      workspaceId: "fixture-linear-workspace",
      teamId: "fixture-linear-team",
      issueId: "fixture-linear-42",
    });
    const task = ui.getByRole("checkbox", {
      name: "Completion of Use native Linear states",
      exact: true,
    });
    await task.click();
    await expect(task).toBeChecked();
    await choose(ui, "Linear Workflow state", "linear-state-done");
    await expect(selectControl(ui, "Linear Workflow state")).toHaveAttribute(
      "data-value",
      "linear-state-done",
    );
    await choose(ui, "Linear Priority", "1");
    await expect(selectControl(ui, "Linear Priority")).toHaveAttribute(
      "data-value",
      "1",
    );
    const labels = ui.getByRole("group", { name: "Labels", exact: true });
    await labels.getByRole("button").click();
    await ui
      .getByRole("dialog")
      .getByRole("option", { name: "Bug · workspace", exact: true })
      .click();
    await expect(labels.getByRole("button")).toContainText("Design");
    await expect(labels.getByRole("button")).toContainText("Bug");
    await page.keyboard.press("Escape");
    await openIssueActions(ui);
    await ui.getByRole("button", { name: "Edit Linear description" }).click();
    await ui
      .getByRole("textbox", { name: "Linear Markdown description" })
      .fill("## Edited in the fixture\n\nA source-specific Linear body.");
    await ui
      .getByRole("region", { name: "Edit Linear description", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(ui.locator(".body-content")).toContainText(
      "A source-specific Linear body.",
    );
  },
);

test("Linear single-choice menus preserve native filters and keep staged definition and relation changes unsaved", async ({
  page,
}) => {
  const ui = app(page);
  await expect(ui.locator("select")).toHaveCount(0);
  await choose(ui, "Linear Team", "fixture-linear-team");
  await choose(ui, "Linear Workflow state", "linear-state-progress");
  await choose(ui, "Linear workflow state", "linear-state-progress");
  const filters = ui.locator(".linear-filters");
  await filters.locator("summary").click();
  await choose(filters, "Assignee", "fixture-linear-user");
  await choose(filters, "Labels", "linear-label-design");
  await choose(filters, "Project", "linear-project");
  await choose(filters, "Sort", "createdAt");
  await expect
    .poll(async () => {
      const calls = (await events(page, "tool")) as {
        name: string;
        arguments: Record<string, unknown>;
      }[];
      return calls.filter((call) => call.name === "linear_list_issues").at(-1)
        ?.arguments;
    })
    .toMatchObject({
      connectionId: "default",
      workspaceId: "fixture-linear-workspace",
      teamId: "fixture-linear-team",
      stateId: "linear-state-progress",
      assigneeId: "fixture-linear-user",
      labelId: "linear-label-design",
      projectId: "linear-project",
      order: "createdAt",
    });
  await filters.locator("summary").click();

  await moreProperties(ui);
  await ui.getByText("Manage label definitions", { exact: true }).click();
  await choose(ui, "Linear label scope", "workspace");
  await expect(selectControl(ui, "Linear label scope")).toHaveAttribute(
    "data-value",
    "workspace",
  );
  await choose(ui, "Linear label definition", "linear-label-design");
  await expect(selectControl(ui, "Linear label scope")).toHaveCount(0);
  await expect(
    ui.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Design");
  await choose(ui, "Linear label definition", "");
  await expect(selectControl(ui, "Linear label scope")).toHaveAttribute(
    "data-value",
    "team",
  );
  await ui
    .getByText("Parent, sub-issues and relations", { exact: true })
    .click();
  await choose(ui, "Linear relation kind", "blocked-by");
  await expect(selectControl(ui, "Linear relation kind")).toHaveAttribute(
    "data-value",
    "blocked-by",
  );
  const writes = ((await events(page, "tool")) as { name: string }[]).filter(
    (call) =>
      [
        "linear_update_issue",
        "linear_label_definition",
        "linear_relation",
      ].includes(call.name),
  );
  expect(writes).toEqual([]);
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
});

test("Linear Labels select multiple native IDs, preserve unavailable selections, and retain failed changes for retry", async ({
  page,
}) => {
  const ui = app(page);
  const labels = ui.getByRole("group", { name: "Labels", exact: true });
  const trigger = labels.getByRole("button");
  const popup = ui.getByRole("dialog");
  const design = popup.getByRole("option", { name: "Design", exact: true });
  const bug = popup.getByRole("option", {
    name: "Bug · workspace",
    exact: true,
  });
  const changes = async () =>
    (
      (await events(page, "tool")) as {
        name: string;
        arguments: {
          add: string[];
          remove: string[];
          requestId: string;
        };
      }[]
    ).filter((call) => call.name === "linear_change_labels");
  let failNext = false;
  let hideSelectedMetadata = false;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "linear_change_labels" && failNext) {
      failNext = false;
      await route.fulfill({
        status: 200,
        json: toolFailure("Fixture labels rejected; try again."),
      });
      return;
    }
    if (input.name === "linear_metadata" && hideSelectedMetadata) {
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.labels = result.structuredContent.labels.filter(
        (label: { id: string }) => label.id !== "linear-label-design",
      );
      result.structuredContent.labels.push({
        id: "linear-label-group",
        name: "Source label group",
        color: "#999999",
        description: null,
        teamId: "fixture-linear-team",
        parentId: null,
        isGroup: true,
      });
      await route.fulfill({ response, json: result });
      return;
    }
    await route.continue();
  });

  await expect(trigger).toHaveText("Design");
  await trigger.focus();
  await page.keyboard.press("j");
  await page.keyboard.press("/");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Space");
  await expect(design).toHaveAttribute("data-selected", "");
  await expect(bug).not.toHaveAttribute("data-selected");
  await page.keyboard.press("Escape");
  await expect(design).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await changes()).toEqual([]);

  await trigger.click();
  await bug.click();
  await expect(trigger).toContainText("Design");
  await expect(trigger).toContainText("Bug");
  await expect(trigger).toBeEnabled();
  await expect(design).toHaveAttribute("data-selected", "");
  await expect(bug).toHaveAttribute("data-selected", "");
  await page.screenshot({ path: "dist/dev/multi-select-linear-fixture.png" });
  expect((await changes())[0]?.arguments).toMatchObject({
    add: ["linear-label-bug"],
    remove: [],
  });

  await design.click();
  await expect(trigger).not.toContainText("Design");
  await expect(trigger).toContainText("Bug");
  await expect(trigger).toBeEnabled();
  await expect(design).not.toHaveAttribute("data-selected");
  await expect(bug).toHaveAttribute("data-selected", "");
  expect((await changes())[1]?.arguments).toMatchObject({
    add: [],
    remove: ["linear-label-design"],
  });

  failNext = true;
  await design.click();
  await expect(ui.locator(".notice")).toContainText("Fixture labels rejected");
  await expect(trigger).not.toContainText("Design");
  await expect(trigger).toBeEnabled();
  await expect(design).not.toHaveAttribute("data-selected");
  await design.click();
  await expect(trigger).toContainText("Design");
  await expect(trigger).toContainText("Bug");
  await expect(trigger).toBeEnabled();
  const retried = await changes();
  expect(retried).toHaveLength(4);
  expect(retried[3]!.arguments.requestId).toBe(retried[2]!.arguments.requestId);
  expect(retried[3]!.arguments).toMatchObject({
    add: ["linear-label-design"],
    remove: [],
  });
  await page.keyboard.press("Escape");

  hideSelectedMetadata = true;
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  await trigger.click();
  await expect(design).toHaveAttribute("aria-disabled", "true");
  await expect(design).toHaveAttribute("data-selected", "");
  await expect(
    popup.getByRole("option", { name: "Source label group", exact: true }),
  ).toHaveCount(0);
  await bug.click();
  await expect(trigger).toHaveText("Design");
  await expect(trigger).toBeEnabled();
  expect((await changes())[4]?.arguments).toMatchObject({
    add: [],
    remove: ["linear-label-bug"],
  });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(selectControl(ui, "Linear Workflow state")).toHaveAttribute(
    "data-value",
    "linear-state-progress",
  );
  await expect(selectControl(ui, "Linear assignee")).toHaveAttribute(
    "data-value",
    "fixture-linear-user",
  );
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
});

test("Linear reaction pickers keep choices quiet, support keyboard dismissal, and retain failed writes for retry", async ({
  page,
}) => {
  const ui = app(page);
  const issueReactions = ui.getByRole("group", {
    name: "Issue reactions",
    exact: true,
  });
  const chooseIssue = issueReactions.getByLabel("Choose Issue reaction", {
    exact: true,
  });
  const issuePicker = issueReactions.locator(".linear-reaction-picker");
  const choices = issueReactions.getByRole("group", {
    name: "Issue reaction choices",
    exact: true,
  });
  await expect(chooseIssue).toBeVisible();
  await expect(issueReactions.locator(":scope > button")).toHaveCount(0);
  await expect(choices).toBeHidden();
  await chooseIssue.focus();
  await page.keyboard.press("Enter");
  await expect(choices).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(choices).toBeHidden();
  await expect(chooseIssue).toBeFocused();
  const reactionCalls = async () =>
    (
      (await events(page, "tool")) as {
        name: string;
        arguments: { requestId: string; action: string; commentId?: string };
      }[]
    ).filter((call) => call.name === "linear_reaction");
  expect(await reactionCalls()).toEqual([]);

  let fail = true;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "linear_reaction" || !fail) {
      await route.continue();
      return;
    }
    fail = false;
    await route.fulfill({
      status: 200,
      json: toolFailure("Fixture reaction rejected; try again."),
    });
  });
  await chooseIssue.click();
  await choices
    .getByRole("button", { name: "Add 👍 Issue reaction", exact: true })
    .click();
  await expect(ui.locator(".notice")).toContainText(
    "Fixture reaction rejected",
  );
  await expect(issuePicker).toHaveAttribute("open", "");
  await expect(issueReactions.locator(":scope > button")).toHaveCount(0);
  await choices
    .getByRole("button", { name: "Add 👍 Issue reaction", exact: true })
    .click();
  await expect(choices).toBeHidden();
  const ownIssueReaction = issueReactions.getByRole("button", {
    name: "Remove 👍 Issue reaction",
    exact: true,
  });
  await expect(ownIssueReaction).toHaveAttribute("aria-pressed", "true");
  await expect(ownIssueReaction).toContainText("1");
  await expect(chooseIssue).toBeFocused();
  const retry = await reactionCalls();
  expect(retry).toHaveLength(2);
  expect(retry[1]!.arguments.requestId).toBe(retry[0]!.arguments.requestId);
  await ownIssueReaction.click();
  await expect(issueReactions.locator(":scope > button")).toHaveCount(0);

  const comment = ui.locator(".linear-comment").first();
  const commentReactions = comment.getByRole("group", {
    name: "comment reactions",
    exact: true,
  });
  const commentChoices = commentReactions.getByRole("group", {
    name: "comment reaction choices",
    exact: true,
  });
  await expect(
    commentReactions.getByLabel("Choose comment reaction", { exact: true }),
  ).toBeVisible();
  await expect(commentReactions.locator(":scope > button")).toHaveCount(0);
  await commentReactions
    .getByLabel("Choose comment reaction", { exact: true })
    .click();
  await commentReactions
    .getByRole("button", { name: "Add ❤️ comment reaction", exact: true })
    .click();
  await expect(commentChoices).toBeHidden();
  await expect(
    commentReactions.getByLabel("Choose comment reaction", { exact: true }),
  ).toBeFocused();
  const ownCommentReaction = commentReactions.getByRole("button", {
    name: "Remove ❤️ comment reaction",
    exact: true,
  });
  await expect(ownCommentReaction).toContainText("1");
  await ownCommentReaction.click();
  await expect(commentReactions.locator(":scope > button")).toHaveCount(0);
  const calls = await reactionCalls();
  expect(calls).toHaveLength(5);
  expect(calls.slice(0, 3).every((call) => !call.arguments.commentId)).toBe(
    true,
  );
  expect(
    calls
      .slice(3)
      .every((call) => call.arguments.commentId === "linear-comment-1"),
  ).toBe(true);
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
});

test("Linear retry keeps a failed request ID after an unrelated successful write", async ({
  page,
}) => {
  const ui = app(page);
  let loseResponse = true;
  const ids: string[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { action?: string; requestId?: string };
    };
    if (
      input.name === "linear_comment" &&
      input.arguments.action === "create"
    ) {
      ids.push(input.arguments.requestId!);
      if (loseResponse) {
        loseResponse = false;
        await route.fetch();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            toolFailure("Simulated lost acknowledgement after fixture save"),
          ),
        });
        return;
      }
    }
    await route.continue();
  });
  await ui
    .getByRole("textbox", { name: "Linear comment", exact: true })
    .fill("One intended comment despite a lost response");
  await ui.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(ui.locator(".notice")).toContainText(
    "Simulated lost acknowledgement",
  );
  await expectDraftWrite(page, {
    comment: "One intended comment despite a lost response",
  });
  await choose(ui, "Issue source", "github");
  await expect(
    ui.getByRole("heading", {
      name: "Preserve issue selection and scroll position",
      exact: true,
    }),
  ).toBeVisible();
  await choose(ui, "Issue source", "linear");
  await expect(
    ui.getByRole("textbox", { name: "Linear comment", exact: true }),
  ).toHaveValue("One intended comment despite a lost response");
  await choose(ui, "Linear Priority", "4");
  await expect(selectControl(ui, "Linear Priority")).toHaveAttribute(
    "data-value",
    "4",
  );
  await ui.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(
    ui.getByRole("textbox", { name: "Linear comment", exact: true }),
  ).toHaveValue("");
  await expect(
    ui
      .locator('[data-linear-context="comment"]')
      .filter({ hasText: "One intended comment despite a lost response" }),
  ).toHaveCount(1);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

test("Linear comment drafts do not freeze clean body content and same-field edits require resolution", async ({
  page,
}) => {
  const ui = app(page);
  await ui
    .getByRole("textbox", { name: "Linear comment", exact: true })
    .fill("Retain this unsent comment");
  await page
    .getByRole("button", {
      name: "Mock Linear external update YU-42",
      exact: true,
    })
    .click();
  await expect(
    ui.getByRole("heading", {
      name: "Linear issue updated by a Codex tool 1",
      exact: true,
    }),
  ).toBeVisible();
  await openIssueActions(ui);
  await ui.getByRole("button", { name: "Edit Linear description" }).click();
  await expect(
    ui.getByRole("textbox", { name: "Linear Markdown description" }),
  ).toHaveValue("External Linear update 1 was fetched into this UI.");
  await ui
    .getByRole("textbox", { name: "Linear Markdown description" })
    .fill("Preserve my Linear body edit");
  await page
    .getByRole("button", {
      name: "Mock Linear external update YU-42",
      exact: true,
    })
    .click();
  await expect(ui.getByRole("textbox", { name: "Linear title" })).toHaveValue(
    "Linear issue updated by a Codex tool 2",
  );
  await expect(
    ui.getByRole("textbox", { name: "Linear Markdown description" }),
  ).toHaveValue("Preserve my Linear body edit");
  await expect(
    ui
      .getByRole("region", { name: "Edit Linear description", exact: true })
      .getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await app(page)
    .getByRole("button", { name: "Compare latest content", exact: true })
    .click();
  await ui
    .getByRole("button", {
      name: "Keep draft and use latest revision",
      exact: true,
    })
    .click();
  await ui
    .getByRole("region", { name: "Edit Linear description", exact: true })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(ui.locator(".body-content")).toContainText(
    "Preserve my Linear body edit",
  );
  await expect(
    ui.getByRole("textbox", { name: "Linear comment", exact: true }),
  ).toHaveValue("Retain this unsent comment");
  const writes = (
    (await events(page, "tool")) as {
      name: string;
      arguments: { patch?: unknown };
    }[]
  ).filter((call) => call.name === "linear_update_issue");
  expect(writes.at(-1)?.arguments.patch).toEqual({
    body: "Preserve my Linear body edit",
  });
});

test(
  "Linear global selection attaches body, comments, titles, properties, list rows, and mixed content",
  { tag: "@smoke" },
  async ({ page }) => {
    const ui = app(page);
    const toolbar = ui.getByRole("toolbar", { name: "Text selection" });
    const addSelection = toolbar.getByRole("button", {
      name: "Add to chat",
      exact: true,
    });
    const select = async (selector: string, releaseOnComment = false) => {
      const editor = ui.getByRole("dialog", {
        name: "Selection comment",
        exact: true,
      });
      if (await editor.isVisible()) await editor.press("Escape");
      const target = ui.locator(selector).first();
      await target.scrollIntoViewIfNeeded();
      return target.evaluate((element, releaseOnComment) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        const release = releaseOnComment
          ? element.closest(".linear-comment")!
          : element;
        release.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return selection.toString();
      }, releaseOnComment);
    };

    const bodyText = await select(".body-content p");
    await expect(toolbar).toBeVisible();
    await addSelection.click();
    await expect.poll(() => events(page, "context")).toHaveLength(1);
    expect(
      latestSharedSelection((await events(page, "context"))[0]),
    ).toMatchObject({
      selection: { text: bodyText, origin: "body" },
    });

    const commentText = await select('[data-linear-context="comment"] p', true);
    await expect(toolbar).toBeVisible();
    await addSelection.click();
    await expect.poll(() => events(page, "context")).toHaveLength(2);
    const contexts = (await events(page, "context")).map(latestSharedSelection);
    expect(contexts[1]).toMatchObject({
      source: "linear",
      id: "fixture-linear-42",
      selection: {
        text: commentText,
        origin: "comment",
        commentId: "linear-comment-1",
      },
    });
    for (const context of contexts) expect(context).not.toHaveProperty("body");

    await ui
      .locator(".linear-comment")
      .first()
      .evaluate((element) => {
        window.getSelection()!.removeAllRanges();
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
    await expect(toolbar).toHaveCount(0);
    await expect(
      ui.getByRole("button", { name: "Add to chat", exact: true }),
    ).toBeVisible();

    await select(".body-content p");
    await expect(toolbar).toBeVisible();
    const mixedText = await ui.locator(".detail-scroll").evaluate((element) => {
      const body = element.querySelector(".body-content p")!;
      const comment = element.querySelector(
        '[data-linear-context="comment"] p',
      )!;
      const range = document.createRange();
      range.setStart(body, 0);
      range.setEnd(comment, comment.childNodes.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const text = selection.toString();
      comment
        .closest(".linear-comment")!
        .dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      // Layout may add closed-details text to later Selection.toString() calls.
      range.getClientRects();
      return text;
    });
    expect(mixedText).not.toContain("Upload files up to 10 MiB to Linear.");
    expect(mixedText).not.toContain("Open Linear for larger files");
    await expect(ui.locator(".linear-upload")).not.toHaveAttribute("open");
    await expect(toolbar).toBeVisible();
    await addSelection.click();
    await expect.poll(() => events(page, "context")).toHaveLength(3);
    expect(
      latestSharedSelection((await events(page, "context"))[2]),
    ).toMatchObject({
      source: "linear",
      id: "fixture-linear-42",
      selection: { text: mixedText, origin: "ui" },
    });

    let shares = 3;
    for (const [selector, issueId] of [
      [".title-line h1", "fixture-linear-42"],
      [".issue-kicker .state-pill", "fixture-linear-42"],
      [".linear-list-row:nth-child(2) .row-title", "fixture-linear-43"],
    ] as const) {
      const text = await select(selector);
      await expect(toolbar).toBeVisible();
      await addSelection.click();
      await expect.poll(() => events(page, "context")).toHaveLength(++shares);
      const context = latestSharedSelection(
        (await events(page, "context")).at(-1),
      );
      expect(context).toMatchObject({
        source: "linear",
        connectionId: "default",
        workspaceId: "fixture-linear-workspace",
        teamId: "fixture-linear-team",
        id: issueId,
        selection: { text, origin: "ui" },
      });
      expect(context).not.toHaveProperty("body");
    }
    await expect(
      ui.getByRole("heading", { name: firstTitle, exact: true }),
    ).toBeVisible();
    await select(".body-content p");
    await expect(toolbar).toBeVisible();
    await ui
      .locator(".detail-toolbar")
      .getByRole("button", { name: "Add to chat", exact: true })
      .click();
    await expect.poll(() => events(page, "context")).toHaveLength(shares + 1);
    const wholeIssue = latestSharedSelection(
      (await events(page, "context")).at(-1),
    );
    expect(wholeIssue).toMatchObject({
      source: "linear",
      id: "fixture-linear-42",
    });
    expect(wholeIssue.body).toContain("This is fictional local fixture data.");
    expect(wholeIssue).not.toHaveProperty("selection");
    expect(await events(page, "message")).toEqual([]);
    const writes = ((await events(page, "tool")) as { name: string }[]).filter(
      (call) =>
        [
          "linear_update_issue",
          "linear_create_issue",
          "linear_comment",
          "linear_bulk",
        ].includes(call.name),
    );
    expect(writes).toEqual([]);
  },
);

test("Linear annotations keep independent comments and native comment identity across later additions and edits", async ({
  page,
}) => {
  const ui = app(page);
  const dialog = ui.getByRole("dialog", {
    name: "Selection comment",
    exact: true,
  });
  const marker = ui.getByRole("button", {
    name: "Edit selection comment 1",
    exact: true,
  });
  const secondMarker = ui.getByRole("button", {
    name: "Edit selection comment 2",
    exact: true,
  });
  const select = async (selector: string) => {
    if (await dialog.isVisible()) await dialog.press("Escape");
    const target = ui.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    const text = await target.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return selection.toString();
    });
    await ui
      .getByRole("toolbar", { name: "Text selection", exact: true })
      .getByRole("button", { name: "Add to chat", exact: true })
      .click();
    return text;
  };
  const commentText = await select('[data-linear-context="comment"] p');
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const comment = dialog.getByRole("textbox", {
    name: "Optional comment",
    exact: true,
  });
  await expect(comment).toHaveValue("");
  await comment.fill("Summarize this comment only");
  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  const update = (await events(page, "context"))[1];
  expect(latestSharedSelection(update)).toMatchObject({
    source: "linear",
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-linear-team",
    id: "fixture-linear-42",
    selection: {
      text: commentText,
      origin: "comment",
      commentId: "linear-comment-1",
      comment: "Summarize this comment only",
    },
  });
  expect(
    (update as { content: { text: string }[] }).content[0]!.text,
  ).toContain("Summarize this comment only");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveText("1");
  await expect(dialog).toHaveCount(0);
  await expect(
    ui.locator('[data-linear-context="comment"] p').first(),
  ).toHaveText(commentText);

  const titleText = await select(".title-line h1");
  await expect.poll(() => events(page, "context")).toHaveLength(3);
  await expect(comment).toHaveValue("");
  await comment.fill("Keep this title note separately");
  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(4);
  const collection = sharedContextFromText((await events(page, "context"))[3]);
  const entries = collection.annotations as SharedAnnotation[];
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({
    number: 1,
    issue: { source: "linear", id: "fixture-linear-42" },
    selection: {
      text: commentText,
      origin: "comment",
      commentId: "linear-comment-1",
      comment: "Summarize this comment only",
    },
  });
  expect(entries[1]).toMatchObject({
    number: 2,
    issue: { source: "linear", id: "fixture-linear-42" },
    selection: {
      text: titleText,
      origin: "ui",
      comment: "Keep this title note separately",
    },
  });
  await expect(marker).toHaveCount(1);
  await expect(secondMarker).toHaveCount(1);
  await expect(secondMarker).toHaveText("2");
  await marker.click();
  await expect(comment).toHaveValue("Summarize this comment only");
  await comment.fill("Revised note for the original comment");
  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(5);
  const edited = sharedContextFromText((await events(page, "context"))[4]);
  const annotations = edited.annotations as SharedAnnotation[];
  expect(annotations[0]).toMatchObject({
    number: 1,
    selection: {
      text: commentText,
      origin: "comment",
      commentId: "linear-comment-1",
      comment: "Revised note for the original comment",
    },
  });
  expect(annotations[1]).toEqual(entries[1]);
  await secondMarker.click();
  await expect(comment).toHaveValue("Keep this title note separately");
  await comment.press("Escape");
  await ui
    .locator(".detail-toolbar")
    .getByRole("button", { name: "Add to chat", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(6);
  expect(
    sharedContextFromText((await events(page, "context"))[5]),
  ).not.toHaveProperty("selection");
  await expect(marker).toHaveCount(0);
  await expect(secondMarker).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  expect(await events(page, "message")).toEqual([]);
  const writes = ((await events(page, "tool")) as { name: string }[]).filter(
    (call) =>
      ["linear_update_issue", "linear_create_issue", "linear_comment"].includes(
        call.name,
      ),
  );
  expect(writes).toEqual([]);
});

test("a single Linear selection retains its inline target without sending a message", async ({
  page,
}) => {
  const ui = app(page);
  const toolbar = ui.getByRole("toolbar", { name: "Text selection" });
  const target = ui.locator(".body-content p").first();
  await target.scrollIntoViewIfNeeded();
  const text = await target.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return selection.toString();
  });
  await toolbar
    .getByRole("button", { name: "Add to chat", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const context = latestSharedSelection((await events(page, "context"))[0]);
  expect(context).toMatchObject({
    source: "linear",
    id: "fixture-linear-42",
    selection: { text, origin: "body" },
  });
  expect(context).not.toHaveProperty("body");
  expect(await events(page, "message")).toEqual([]);
  const explicitContext = await events(page, "context");
  await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await expect(ui.locator(".toolbar-target")).toHaveText("YU-43");
  await expect(ui.locator(".shared-chip")).toHaveText("Chat: YU-42");
  await expect(ui.locator(".shared-chip")).toHaveAttribute(
    "aria-label",
    "Shared issue: YU-42 · Different from the issue you are browsing",
  );
  await expect(ui.locator(".shared-target")).toHaveCount(0);
  expect(await events(page, "message")).toHaveLength(0);
  await expect(ui.locator(".shared-chip")).toHaveText("Chat: YU-42");
  expect(await events(page, "context")).toEqual(explicitContext);
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(ui.locator(".inline-mode")).toContainText("YU-42");
  await ui.getByRole("button", { name: "Open details", exact: true }).click();
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(ui.locator(".toolbar-target")).toHaveText("YU-42");
  await expect(ui.locator(".shared-chip")).toHaveText("In chat");
  await expect(ui.locator(".shared-chip")).toHaveAttribute(
    "aria-label",
    "Shared issue: YU-42",
  );
  await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await ui
    .getByRole("button", { name: "Back to Linear list", exact: true })
    .click();
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(ui.locator(".inline-mode")).toContainText("YU-42");
  await ui.getByRole("button", { name: "Open details", exact: true }).click();
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(
    ui.getByRole("button", { name: "Back to Linear list", exact: true }),
  ).toBeVisible();
  await ui.locator(".detail-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() =>
      ui.locator(".detail-scroll").evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  await expect(ui.locator(".toolbar-target")).toHaveText("YU-42");
  await expect(ui.locator(".toolbar-target")).toBeInViewport();
  await expect(ui.locator(".shared-chip")).toHaveText("In chat");
  await expect(ui.locator(".shared-chip")).toBeInViewport();
  await expect(ui.locator(".shared-target")).toHaveCount(0);
  expect(await events(page, "context")).toEqual(explicitContext);
  expect(await events(page, "message")).toEqual([]);
});

test("Linear bulk labels, priority, estimate, and due dates preserve per-Issue results", async ({
  page,
}) => {
  const ui = app(page);
  const bulk = ui.getByRole("region", { name: "Bulk Linear actions" });
  for (const [action, control, value] of [
    ["priority", "Bulk Linear priority", "4"],
    ["estimate", "Bulk Linear estimate", "5"],
    ["label-add", "Bulk Linear label", "linear-label-bug"],
  ] as const) {
    for (const number of [42, 43])
      await ui
        .getByRole("checkbox", {
          name: `YU-${number} — select for bulk actions`,
        })
        .check();
    await choose(bulk, "Bulk Linear action", action);
    await choose(bulk, control, value);
    await bulk.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(bulk).toHaveCount(0);
  }
  for (const number of [42, 43])
    await ui
      .getByRole("checkbox", { name: `YU-${number} — select for bulk actions` })
      .check();
  await choose(bulk, "Bulk Linear action", "due-date");
  await bulk
    .getByLabel("Bulk Linear due date", { exact: true })
    .fill("2026-11-02");
  await bulk.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(bulk).toHaveCount(0);
  await moreProperties(ui);
  await expect(ui.getByLabel("Linear Due date", { exact: true })).toHaveValue(
    "2026-11-02",
  );
  await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await expect(selectControl(ui, "Linear Priority")).toHaveAttribute(
    "data-value",
    "4",
  );
  await moreProperties(ui);
  await expect(selectControl(ui, "Linear Estimate")).toHaveAttribute(
    "data-value",
    "5",
  );
  await moreProperties(ui);
  await expect(ui.getByLabel("Linear Due date", { exact: true })).toHaveValue(
    "2026-11-02",
  );
  await expect(
    ui.getByRole("group", { name: "Labels", exact: true }).getByRole("button"),
  ).toContainText("Bug");
});

test("Linear templates preserve source defaults, permit explicit empty bodies, and restore creation drafts", async ({
  page,
}) => {
  const ui = app(page);
  await ui
    .getByRole("button", { name: "Create Linear Issue", exact: true })
    .click();
  const dialog = ui.getByRole("dialog", { name: "Create Linear Issue" });
  await choose(dialog, "Linear template", "linear-simple-template");
  const templateTrigger = selectControl(dialog, "Linear template").getByRole(
    "button",
  );
  await templateTrigger.focus();
  await page.keyboard.press("Space");
  await expect(templateTrigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(templateTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeVisible();
  await expect(templateTrigger).toBeFocused();
  await expect(
    dialog.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Template issue");
  await expect(
    dialog.getByRole("textbox", { name: "Markdown description", exact: true }),
  ).toHaveValue(/Preserve this default body/);
  await expectDraftWrite(page, { title: "Template issue" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await ui
    .getByRole("button", { name: "Create Linear Issue", exact: true })
    .click();
  await expect(selectControl(dialog, "Linear template")).toHaveAttribute(
    "data-value",
    "linear-simple-template",
  );
  await dialog
    .getByRole("button", { name: "Create in Linear", exact: true })
    .click();
  await expect(
    ui.getByRole("heading", { name: "Template issue", exact: true }),
  ).toBeVisible();
  await expect(ui.locator(".body-content")).toContainText(
    "Preserve this default body.",
  );
  await expect(selectControl(ui, "Linear Priority")).toHaveAttribute(
    "data-value",
    "3",
  );
  const creates = (
    (await events(page, "tool")) as {
      name: string;
      arguments: Record<string, unknown>;
    }[]
  ).filter((call) => call.name === "linear_create_issue");
  expect(creates[0].arguments).not.toHaveProperty("body");
  await ui
    .getByRole("button", { name: "Create Linear Issue", exact: true })
    .click();
  await choose(dialog, "Linear template", "linear-form-template");
  await expect(
    dialog.getByRole("button", {
      name: "Open Linear to use this template",
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Create in Linear", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", {
      name: "Open Linear to use this template",
      exact: false,
    })
    .click();
  await expect
    .poll(() => events(page, "link"))
    .toContainEqual({
      url: "https://linear.app/new?team=fixture-linear-team&template=linear-form-template",
    });
  await expect(dialog).toBeVisible();
  await expect(selectControl(dialog, "Linear template")).toHaveAttribute(
    "data-value",
    "linear-form-template",
  );
  expect(
    ((await events(page, "tool")) as { name: string }[]).filter(
      (call) => call.name === "linear_create_issue",
    ),
  ).toHaveLength(creates.length);
  await choose(dialog, "Linear template", "linear-simple-template");
  await expect(
    dialog.getByRole("textbox", { name: "Markdown description", exact: true }),
  ).toHaveValue(/Preserve this default body/);
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("An explicitly empty description");
  await dialog
    .getByRole("textbox", { name: "Markdown description", exact: true })
    .fill("");
  await dialog
    .getByRole("button", { name: "Create in Linear", exact: true })
    .click();
  await expect(
    ui.getByRole("heading", {
      name: "An explicitly empty description",
      exact: true,
    }),
  ).toBeVisible();
  await expect(ui.locator(".body-content")).toContainText("No description.");
  const latest = (
    (await events(page, "tool")) as {
      name: string;
      arguments: Record<string, unknown>;
    }[]
  )
    .filter((call) => call.name === "linear_create_issue")
    .at(-1);
  expect(latest?.arguments.body).toBe("");
});

test(
  "Linear comment edits and reply drafts survive switches and preserve thread parents",
  { tag: "@smoke" },
  async ({ page }) => {
    const ui = app(page);
    await ui
      .locator(".linear-comment")
      .first()
      .getByRole("button", { name: "Reply", exact: true })
      .click();
    await ui
      .getByRole("textbox", { name: "Linear comment", exact: true })
      .fill("A reply preserved across an Issue switch");
    await expect(
      ui.getByRole("button", { name: "Cancel reply", exact: true }),
    ).toBeVisible();
    await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
    await expect(
      ui.getByRole("heading", { name: secondTitle, exact: true }),
    ).toBeVisible();
    await ui.locator(".issue-row").filter({ hasText: firstTitle }).click();
    await expect(
      ui.getByRole("heading", { name: firstTitle, exact: true }),
    ).toBeVisible();
    await expect(
      ui.getByRole("textbox", { name: "Linear comment", exact: true }),
    ).toHaveValue("A reply preserved across an Issue switch");
    await expect(
      ui.getByRole("button", { name: "Cancel reply", exact: true }),
    ).toBeVisible();
    await ui.getByRole("button", { name: "Comment", exact: true }).click();
    const reply = ui
      .locator(".linear-comment-reply")
      .filter({ hasText: "A reply preserved across an Issue switch" });
    await expect(reply).toHaveCount(1);
    await reply.getByRole("button", { name: "Edit", exact: true }).click();
    await ui
      .getByRole("textbox", { name: "Edit Linear comment", exact: true })
      .fill("A persisted existing-comment edit");
    await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
    await ui.locator(".issue-row").filter({ hasText: firstTitle }).click();
    await ui
      .locator(".linear-comment-reply")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await expect(
      ui.getByRole("textbox", { name: "Edit Linear comment", exact: true }),
    ).toHaveValue("A persisted existing-comment edit");
    await expect(
      ui
        .locator(".linear-comment-editor")
        .getByRole("button", { name: "Save", exact: true }),
    ).toHaveAttribute("data-color", "primary");
    await expect(
      ui
        .locator(".linear-comment-editor")
        .getByRole("button", { name: "Save", exact: true }),
    ).toHaveAttribute("data-variant", "solid");
    await ui
      .locator(".linear-comment-editor")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      ui.locator('.linear-comment-reply [data-linear-context="comment"]'),
    ).toHaveText("A persisted existing-comment edit");
    await expect(
      ui.getByRole("textbox", { name: "Edit Linear comment", exact: true }),
    ).toHaveCount(0);
    const comments = (
      (await events(page, "tool")) as {
        name: string;
        arguments: Record<string, unknown>;
      }[]
    ).filter((call) => call.name === "linear_comment");
    expect(
      comments.find((call) => call.arguments.action === "create")?.arguments
        .parentId,
    ).toBe("linear-comment-1");
    expect(
      comments.find((call) => call.arguments.action === "update")?.arguments,
    ).toHaveProperty("expectedUpdatedAt");
  },
);

test("Linear viewport and theme updates preserve the issue and unsent comment without tool requests", async ({
  page,
}) => {
  test.setTimeout(20_000);
  const ui = app(page);
  const comment = ui.getByRole("textbox", {
    name: "Linear comment",
    exact: true,
  });
  const draft =
    "Keep this unsent Linear comment through viewport and theme changes";
  const active = async () =>
    (
      (await events(page, "tool-pressure")).at(-1) as
        { active: number } | undefined
    )?.active ?? 0;
  await ui.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await comment.fill(draft);
  await expectDraftWrite(page, { comment: draft });
  await expect.poll(active).toBe(0);
  // Let pending settings/draft timers settle before measuring presentation alone.
  await page.waitForTimeout(350);
  await expect.poll(active).toBe(0);
  const before = await events(page, "tool");
  const instance = await comment.evaluate((element) => {
    element.dataset.resizeInstance = crypto.randomUUID();
    return element.dataset.resizeInstance;
  });
  await page.getByText("Mock host events", { exact: true }).click();
  try {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 920, height: 640 },
      { width: 390, height: 844 },
      { width: 390, height: 520 },
      { width: 1280, height: 720 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page
        .getByRole("button", { name: "Mock presentation updates", exact: true })
        .click();
      // Layout/theme notifications must remain quiet beyond their coalescing window.
      await page.waitForTimeout(350);
      await expect(
        ui.getByRole("heading", { name: firstTitle, exact: true }),
      ).toBeVisible();
      await expect(comment).toHaveValue(draft);
      await expect(comment).toHaveAttribute("data-resize-instance", instance);
      expect(await events(page, "tool")).toEqual(before);
      expect(await active()).toBe(0);
      expect(await events(page, "context")).toEqual([]);
      expect(await events(page, "message")).toEqual([]);
      expect(await events(page, "tool-rejected")).toEqual([]);
      await expect(ui.getByText(/request queue is full/)).toHaveCount(0);
    }
    expect(await events(page, "presentation-updates")).toHaveLength(6);
    await expect(page.locator("#harness-error")).toBeEmpty();
  } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
});

test("Linear keyboard, narrow layout, filter/draft reload, and upload bounds remain usable", async ({
  page,
}, info) => {
  const ui = app(page);
  await ui.locator(".detail-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: info.outputPath("linear-wide.png"),
    fullPage: true,
  });
  await ui.getByRole("heading", { name: firstTitle, exact: true }).click();
  await page.keyboard.press("j");
  await expect(
    ui.getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("k");
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await ui
    .getByRole("textbox", { name: "Search Linear Issues", exact: true })
    .fill("workflow");
  await ui
    .getByRole("textbox", { name: "Linear comment", exact: true })
    .fill("A locally saved Linear comment");
  await expectDraftWrite(page, { comment: "A locally saved Linear comment" });
  await moreProperties(ui);
  await ui
    .getByText("Parent, sub-issues and relations", { exact: true })
    .click();
  await ui.getByText("Create sub-issue", { exact: true }).click();
  await ui
    .getByRole("textbox", { name: "Sub-issue title", exact: true })
    .fill("A locally preserved child");
  await ui
    .getByRole("textbox", { name: "Sub-issue description", exact: true })
    .fill("A child draft before source creation");
  await expectDraftWrite(page, {
    title: "A locally preserved child",
    body: "A child draft before source creation",
  });
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(
    ui.getByRole("textbox", { name: "Search Linear Issues", exact: true }),
  ).toHaveValue("workflow");
  await expect(
    ui.getByRole("textbox", { name: "Linear comment", exact: true }),
  ).toHaveValue("A locally saved Linear comment");
  await moreProperties(ui);
  await ui
    .getByText("Parent, sub-issues and relations", { exact: true })
    .click();
  await ui.getByText("Create sub-issue", { exact: true }).click();
  await expect(
    ui.getByRole("textbox", { name: "Sub-issue title", exact: true }),
  ).toHaveValue("A locally preserved child");
  await expect(
    ui.getByRole("textbox", { name: "Sub-issue description", exact: true }),
  ).toHaveValue("A child draft before source creation");
  await ui.getByText("Add file or URL", { exact: true }).click();
  await ui.getByLabel("Upload file to Linear", { exact: true }).setInputFiles({
    name: "too-large.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(ui.locator(".notice")).toContainText("up to 10 MiB");
  const uploads = ((await events(page, "tool")) as { name: string }[]).filter(
    (call) => call.name === "linear_upload",
  );
  expect(uploads).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await ui.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await expect(
    ui.getByRole("button", { name: "Back to Linear list" }),
  ).toBeVisible();
  await expect(
    ui.getByRole("button", { name: "Add to chat", exact: true }),
  ).toBeVisible();
  await ui.locator(".detail-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: info.outputPath("linear-narrow.png"),
    fullPage: true,
  });
  expect(
    await frame.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await ui.getByRole("button", { name: "Back to Linear list" }).click();
  await expect(
    ui.getByRole("textbox", { name: "Search Linear Issues" }),
  ).toBeVisible();
});

test("Linear duplicate workflow meanings remain visible and require the source merge flow", async ({
  page,
}) => {
  const ui = app(page);
  const duplicate = {
    id: "linear-state-duplicate",
    name: "Duplicate",
    type: "duplicate",
    color: "#bbc3cc",
  };
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (
      !["linear_get_issue", "linear_list_issues", "linear_metadata"].includes(
        input.name,
      )
    ) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const result = await response.json();
    if (input.name === "linear_metadata")
      result.structuredContent.states.push(duplicate);
    else if (input.name === "linear_get_issue")
      result.structuredContent.state = duplicate;
    else result.structuredContent.issues[0].state = duplicate;
    await route.fulfill({ response, json: result });
  });
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  await expect(selectControl(ui, "Linear Workflow state")).toHaveAttribute(
    "data-value",
    duplicate.id,
  );
  await expect(
    selectControl(ui, "Linear Workflow state").getByRole("button"),
  ).toBeDisabled();
  await expect(
    ui.getByText("This issue is marked as duplicate.", { exact: false }),
  ).toBeVisible();
  await ui
    .getByRole("checkbox", {
      name: "YU-42 — select for bulk actions",
      exact: true,
    })
    .check();
  const bulk = ui.getByRole("region", { name: "Bulk Linear actions" });
  await expect(
    selectControl(bulk, "Bulk Linear workflow state").getByRole("button"),
  ).toBeDisabled();
  await expect(
    bulk.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
  const writes = ((await events(page, "tool")) as { name: string }[]).filter(
    (call) => ["linear_update_issue", "linear_bulk"].includes(call.name),
  );
  expect(writes).toEqual([]);
});

test("Linear refresh failures keep cached issue content and drafts usable until retry succeeds", async ({
  page,
}) => {
  const ui = app(page);
  await ui
    .getByRole("textbox", { name: "Linear comment", exact: true })
    .fill("Keep this unsent Linear comment when the host queue is full");
  let fail = true;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "linear_get_issue" || !fail) return route.continue();
    return route.fulfill({
      json: toolFailure("MCP error -32001: App server request queue is full"),
    });
  });
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  const refreshError = ui
    .getByRole("alert")
    .filter({ hasText: "Could not refresh this issue." });
  await expect(refreshError).toContainText("Showing the last loaded version.");
  await expect(refreshError).toContainText("App server request queue is full");
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(ui.locator(".detail-pane > .empty-state")).toHaveCount(0);
  await expect(
    ui.getByRole("textbox", { name: "Linear comment", exact: true }),
  ).toHaveValue("Keep this unsent Linear comment when the host queue is full");
  fail = false;
  await refreshError
    .getByRole("button", { name: "Retry refresh", exact: true })
    .click();
  await expect(refreshError).toHaveCount(0);
  await expect(
    ui.getByRole("textbox", { name: "Linear comment", exact: true }),
  ).toHaveValue("Keep this unsent Linear comment when the host queue is full");
  const tools = (await events(page, "tool")) as {
    arguments: Record<string, unknown>;
  }[];
  expect(tools.filter((tool) => "requestId" in tool.arguments)).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
  expect(await events(page, "context")).toEqual([]);
});

test("Linear visible source queries refresh without host resource notifications", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const ui = app(page);
  const requested = page.waitForRequest(
    (request) =>
      request.url().endsWith("/tool") &&
      request.method() === "POST" &&
      request.postDataJSON().name === "linear_get_issue",
  );
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  const request = await requested;
  const { session } = request.postDataJSON() as { session: string };
  const current = await (await request.response())!.json();
  const result = await page.request.post("/tool", {
    data: {
      session,
      name: "linear_update_issue",
      arguments: {
        connectionId: "default",
        workspaceId: "fixture-linear-workspace",
        teamId: "fixture-linear-team",
        issueId: "fixture-linear-42",
        requestId: "silent-linear-update",
        expectedUpdatedAt: current.structuredContent.updatedAt,
        patch: { title: "Linear updated without a bridge event" },
      },
    },
  });
  expect((await result.json()).isError).toBeUndefined();
  await expect(
    ui.getByRole("heading", {
      name: "Linear updated without a bridge event",
      exact: true,
    }),
  ).toBeVisible({ timeout: 35_000 });
  expect(await events(page, "linear-external-update")).toEqual([]);
});

test("Linear source switches retain browsing and list position while using the latest shared context", async ({
  page,
}) => {
  const ui = app(page);
  const completedSearches: string[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { query?: string };
    };
    if (input.name !== "linear_list_issues") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const result = await response.json();
    const sample = result.structuredContent.issues[0];
    for (let i = 0; i < 16; i++)
      result.structuredContent.issues.push({
        ...sample,
        issueId: `fixture-list-only-${i}`,
        identifier: `YU-${100 + i}`,
        title: `Additional fixture list row ${i}`,
      });
    await route.fulfill({ response, json: result });
    completedSearches.push(input.arguments.query ?? "");
  });
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  await expect(ui.locator(".issue-row")).toHaveCount(18);
  await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await ui.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  await ui.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await ui
    .getByRole("textbox", { name: "Search Linear Issues", exact: true })
    .fill("Linear");
  // Both searches return 18 rows, so the row count alone cannot await debounce.
  await expect.poll(() => completedSearches).toContain("Linear");
  await expect(ui.locator(".issue-list")).toHaveAttribute("aria-busy", "false");
  await expect(ui.locator(".issue-row")).toHaveCount(18);
  const position = await ui.locator(".issue-list").evaluate((element) => {
    element.scrollTop = 150;
    return element.scrollTop;
  });
  expect(position).toBeGreaterThan(0);
  await choose(ui, "Issue source", "github");
  await choose(ui, "Issue source", "linear");
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(ui.locator(".toolbar-target")).toHaveText("YU-42");
  await expect(ui.locator(".shared-chip")).toHaveText("Chat: YU-43");
  await expect(ui.locator(".shared-chip")).toHaveAttribute(
    "aria-label",
    "Shared issue: YU-43 · Different from the issue you are browsing",
  );
  await expect(ui.locator(".shared-target")).toHaveCount(0);
  await expect
    .poll(() =>
      ui.locator(".issue-list").evaluate((element) => element.scrollTop),
    )
    .toBe(position);
  await choose(ui, "Issue source", "github");
  await expect(
    ui.getByRole("heading", {
      name: "Preserve issue selection and scroll position",
      exact: true,
    }),
  ).toBeVisible();
  await ui.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  expect(
    latestSharedSelection((await events(page, "context"))[1]),
  ).toMatchObject({ source: "github", repo: "yu/Arco", number: 42 });
  await choose(ui, "Issue source", "linear");
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(ui.locator(".toolbar-target")).toHaveText("YU-42");
  await expect(ui.locator(".shared-chip")).toHaveCount(0);
  await expect(ui.locator(".shared-target")).toHaveCount(0);
  await expect
    .poll(() =>
      ui.locator(".issue-list").evaluate((element) => element.scrollTop),
    )
    .toBe(position);
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(ui.locator(".inline-mode")).toContainText("YU-42");
  await expect(ui.locator(".inline-mode .compact-bottom")).toHaveCount(0);
  expect(await events(page, "context")).toHaveLength(2);
  expect(await events(page, "message")).toHaveLength(0);
  const writes = ((await events(page, "tool")) as { name: string }[]).filter(
    (call) =>
      [
        "linear_update_issue",
        "linear_create_issue",
        "linear_comment",
        "linear_bulk",
      ].includes(call.name),
  );
  expect(writes).toEqual([]);
});

test("Linear acknowledged writes retain receipts and clear posted drafts when readback fails", async ({
  page,
}) => {
  const ui = app(page);
  let unavailableIssue = "";
  let allowRead = false;
  let createdId = "";
  let createdCommentId = "";
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { action?: string; issueId?: string; requestId?: string };
    };
    if (
      input.name === "linear_get_issue" &&
      input.arguments.issueId === unavailableIssue &&
      !allowRead
    ) {
      await route.fulfill({
        status: 200,
        json: toolFailure("Fixture source readback is temporarily unavailable"),
      });
      return;
    }
    if (
      input.name === "linear_create_issue" ||
      (input.name === "linear_comment" && input.arguments.action === "create")
    ) {
      const response = await route.fetch();
      const result = await response.json();
      const issue = result.structuredContent;
      unavailableIssue = issue.issueId;
      allowRead = false;
      if (input.name === "linear_create_issue") createdId = issue.issueId;
      else createdCommentId = issue.comments.at(-1).id;
      const receipt = {
        connectionId: issue.connectionId,
        workspaceId: issue.workspaceId,
        teamId: issue.teamId,
        issueId: issue.issueId,
        kind: "linear_saved_receipt",
        saved: true,
        operation:
          input.name === "linear_create_issue"
            ? "create_issue"
            : "create_comment",
        message:
          "Linear confirmed this write. Its preview is temporarily unavailable.",
        ...(input.name === "linear_comment"
          ? { commentId: issue.comments.at(-1).id }
          : {}),
      };
      await route.fulfill({
        response,
        json: {
          content: [{ type: "text", text: receipt.message }],
          structuredContent: receipt,
        },
      });
      return;
    }
    await route.continue();
  });
  await ui
    .getByRole("button", { name: "Create Linear Issue", exact: true })
    .click();
  const dialog = ui.getByRole("dialog", {
    name: "Create Linear Issue",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("A confirmed Linear creation");
  await dialog
    .getByRole("textbox", { name: "Markdown description", exact: true })
    .fill("The source acknowledged this creation.");
  await dialog
    .getByRole("button", { name: "Create in Linear", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const receipt = ui.locator(".linear-saved-receipt");
  await expect(receipt).toHaveAttribute("aria-label", "Saved Linear receipt");
  await expect(receipt).toContainText("Saved in Linear");
  await expect(receipt).toContainText("Linear confirmed this write.");
  await expect(receipt.locator(":scope > div > p")).not.toContainText(
    createdId,
  );
  await expect(
    receipt.getByText(`Issue ID: ${createdId}`, { exact: true }),
  ).not.toBeVisible();
  await receipt.getByText("Request receipt", { exact: true }).click();
  await expect(
    receipt.getByText(`Issue ID: ${createdId}`, { exact: true }),
  ).toBeVisible();
  const creates = (
    (await events(page, "tool")) as {
      name: string;
      arguments: { requestId: string };
    }[]
  ).filter((call) => call.name === "linear_create_issue");
  expect(creates).toHaveLength(1);
  await expect(receipt.locator("code")).toHaveText(
    creates[0].arguments.requestId,
  );
  await ui
    .getByRole("button", { name: "Create Linear Issue", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("");
  await page.keyboard.press("Escape");
  await choose(ui, "Issue source", "github");
  await choose(ui, "Issue source", "linear");
  await expect(receipt).toContainText(createdId);
  allowRead = true;
  await receipt
    .getByRole("button", { name: "Check saved issue", exact: true })
    .click();
  await expect(
    ui.getByRole("heading", {
      name: "A confirmed Linear creation",
      exact: true,
    }),
  ).toBeVisible();
  await ui
    .getByRole("textbox", { name: "Linear comment", exact: true })
    .fill("A confirmed comment despite readback failure");
  await ui.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(
    ui.getByRole("textbox", { name: "Linear comment", exact: true }),
  ).toHaveValue("");
  await expect(receipt.locator(":scope > div > p")).not.toContainText(
    createdId,
  );
  await expect(receipt.locator(":scope > div > p")).not.toContainText(
    createdCommentId,
  );
  const receiptDetails = receipt.locator("details");
  if ((await receiptDetails.getAttribute("open")) !== null)
    await receipt.getByText("Request receipt", { exact: true }).click();
  await expect(
    receipt.getByText(`Comment ID: ${createdCommentId}`, { exact: true }),
  ).not.toBeVisible();
  await receipt.getByText("Request receipt", { exact: true }).click();
  await expect(
    receipt.getByText(`Comment ID: ${createdCommentId}`, { exact: true }),
  ).toBeVisible();
  allowRead = true;
  await receipt
    .getByRole("button", { name: "Check saved issue", exact: true })
    .click();
  await expect(
    ui
      .locator('[data-linear-context="comment"]')
      .filter({ hasText: "A confirmed comment despite readback failure" }),
  ).toHaveCount(1);
  const comments = (
    (await events(page, "tool")) as {
      name: string;
      arguments: { action?: string };
    }[]
  ).filter(
    (call) =>
      call.name === "linear_comment" && call.arguments.action === "create",
  );
  expect(comments).toHaveLength(1);
});

test("shared Linear native ref survives host view recreation and fullscreen return", async ({
  page,
}) => {
  const ui = app(page);
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await ui.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const context = latestSharedSelection((await events(page, "context"))[0]);
  expect(context).toMatchObject({
    source: "linear",
    id: "fixture-linear-43",
    identifier: "YU-43",
    title: secondTitle,
  });
  expect(context.body).toContain("This is fictional local fixture data.");
  expect(context).not.toHaveProperty("selection");
  await ui.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(ui.locator(".inline-mode")).toContainText("YU-43");
  await frame.goto(frame.url());
  await expect(ui.locator(".inline-mode")).toContainText("YU-43");
  await ui.getByRole("button", { name: "Open details", exact: true }).click();
  await expect
    .poll(async () => (await events(page, "display")).at(-1))
    .toBe("fullscreen");
  await frame.goto(frame.url());
  await expect(
    ui.getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  const calls = (
    (await events(page, "tool")) as {
      name: string;
      arguments: Record<string, unknown>;
    }[]
  ).filter((call) => call.name === "linear_get_issue");
  expect(calls.at(-1)?.arguments).toEqual({
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-linear-team",
    issueId: "fixture-linear-43",
  });
  expect(await events(page, "context")).toHaveLength(1);
  expect(await events(page, "message")).toEqual([]);
});

test("Linear inline details report a refused fullscreen request and allow retry", async ({
  page,
}) => {
  const ui = app(page);
  await ui.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(ui.locator(".inline-mode")).toContainText("YU-42");
  await page
    .getByRole("checkbox", {
      name: "Mock keep current display mode",
      exact: true,
    })
    .check();

  await ui.getByRole("button", { name: "Open details", exact: true }).click();

  await expect(ui.locator(".inline-mode")).toBeVisible();
  await expect(ui.getByRole("alert")).toHaveText(
    "Could not open issue details. Try again.",
  );
  await expect(
    ui.getByText("Display mode updated.", { exact: true }),
  ).toHaveCount(0);
  expect((await events(page, "display-request")).at(-1)).toEqual({
    requested: "fullscreen",
    actual: "inline",
  });

  await page
    .getByRole("checkbox", {
      name: "Mock keep current display mode",
      exact: true,
    })
    .uncheck();
  await ui.getByRole("button", { name: "Open details", exact: true }).click();

  await expect(ui.locator(".linear-workspace")).toBeVisible();
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  expect((await events(page, "display-request")).at(-1)).toEqual({
    requested: "fullscreen",
    actual: "fullscreen",
  });
  expect(await events(page, "context")).toHaveLength(1);
  expect(await events(page, "message")).toEqual([]);
});

test("Linear disconnect keeps local drafts, settings, and chat context while stopping background reads", async ({
  page,
}) => {
  await page.clock.install();
  const authorization = await mockLinearAuthorization(page);
  const ui = app(page);
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await ui.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const contexts = await events(page, "context");
  await ui
    .getByRole("textbox", { name: "Search Linear Issues", exact: true })
    .fill("workflow");
  await ui
    .getByRole("textbox", { name: "Linear comment", exact: true })
    .fill("Keep this unsent comment after disconnect");
  await openIssueActions(ui);
  await ui
    .getByRole("button", { name: "Edit Linear description", exact: true })
    .click();
  await ui
    .getByRole("textbox", { name: "Linear title", exact: true })
    .fill("A preserved issue title draft");
  await ui
    .getByRole("textbox", { name: "Linear Markdown description", exact: true })
    .fill("A preserved description draft");
  await expectDraftWrite(page, {
    title: "A preserved issue title draft",
    body: "A preserved description draft",
  });
  await ui
    .getByRole("button", { name: "Close and keep draft", exact: true })
    .click();
  await ui
    .getByRole("button", { name: "Create Linear Issue", exact: true })
    .click();
  const dialog = ui.getByRole("dialog", {
    name: "Create Linear Issue",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("A preserved new issue draft");
  await dialog
    .getByRole("textbox", { name: "Markdown description", exact: true })
    .fill("A new description kept locally");
  await expectDraftWrite(page, {
    title: "A preserved new issue draft",
    body: "A new description kept locally",
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await disconnectLinear(page);
  await expect(ui.getByText("Connect Linear", { exact: true })).toBeVisible();
  await expect(ui.locator(".notice")).toHaveCount(0);
  expect(authorization.disconnects).toEqual([
    { connectionId: "default", revoke: false },
  ]);
  await expect(
    ui.getByLabel("Linear connection actions", { exact: true }),
  ).toBeFocused();
  const reads = async () =>
    ((await events(page, "tool")) as { name: string }[]).filter((call) =>
      [
        "linear_scopes",
        "linear_metadata",
        "linear_templates",
        "linear_list_issues",
        "linear_get_issue",
      ].includes(call.name),
    );
  const before = await reads();
  const externalUpdate = await ui.locator("html").evaluateHandle(() => {
    const state = { received: false };
    const receive = (event: MessageEvent) => {
      const result = event.data?.params?.structuredContent;
      if (
        event.source !== window.parent ||
        event.data?.method !== "ui/notifications/tool-result" ||
        result?.repo !== "yu/Arco" ||
        result?.number !== 42 ||
        result?.title !== "Issue updated by a Codex tool"
      )
        return;
      state.received = true;
      window.removeEventListener("message", receive);
    };
    window.addEventListener("message", receive);
    return state;
  });
  await page
    .getByRole("button", { name: "Mock external update #42", exact: true })
    .click();
  await expect
    .poll(() => externalUpdate.evaluate((state) => state.received))
    .toBe(true);
  await externalUpdate.dispose();
  expect(await events(page, "external-update")).toHaveLength(1);
  await page.clock.fastForward(31_000);
  await page.bringToFront();
  await expect(ui.getByText("Connect Linear", { exact: true })).toBeVisible();
  expect(await reads()).toEqual(before);
  expect(await events(page, "context")).toEqual(contexts);
  expect(await events(page, "message")).toEqual([]);

  authorization.connected = true;
  await ui
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(
    ui.getByRole("textbox", { name: "Search Linear Issues", exact: true }),
  ).toHaveValue("workflow");
  await expect(
    ui.getByRole("textbox", { name: "Linear title", exact: true }),
  ).toHaveValue("A preserved issue title draft");
  await expect(
    ui.getByRole("textbox", {
      name: "Linear Markdown description",
      exact: true,
    }),
  ).toHaveValue("A preserved description draft");
  await expect(
    ui.getByRole("textbox", { name: "Linear comment", exact: true }),
  ).toHaveValue("Keep this unsent comment after disconnect");
  await ui
    .getByRole("button", { name: "Create Linear Issue", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("A preserved new issue draft");
  await expect(
    dialog.getByRole("textbox", { name: "Markdown description", exact: true }),
  ).toHaveValue("A new description kept locally");
  expect(await events(page, "context")).toEqual(contexts);
  const calls = (await events(page, "tool")) as { name: string }[];
  expect(
    calls.some((call) =>
      [
        "linear_create_issue",
        "linear_update_issue",
        "linear_comment",
        "arco_delete_draft",
      ].includes(call.name),
    ),
  ).toBe(false);
});

test("Linear disconnect reports credential removal failure and reconciles a lost acknowledgement", async ({
  page,
}) => {
  const authorization = await mockLinearAuthorization(page);
  const ui = app(page);
  const comment = ui.getByRole("textbox", {
    name: "Linear comment",
    exact: true,
  });
  await comment.fill("Keep the draft when credential removal fails");
  authorization.disconnectFailure = true;
  await disconnectLinear(page);
  await expect(ui.locator(".notice")).toContainText(
    "could not be removed from the OS credential store",
  );
  await expect(comment).toHaveValue(
    "Keep the draft when credential removal fails",
  );
  await expect(ui.getByText("Connect Linear", { exact: true })).toHaveCount(0);
  await expect(
    ui.getByLabel("Linear connection actions", { exact: true }),
  ).toBeFocused();
  authorization.disconnectFailure = false;
  authorization.loseAcknowledgement = true;
  await disconnectLinear(page);
  await expect(ui.getByText("Connect Linear", { exact: true })).toBeVisible();
  await expect(ui.locator(".notice")).toHaveCount(0);
  expect(authorization.disconnects).toEqual([
    { connectionId: "default", revoke: false },
    { connectionId: "default", revoke: false },
  ]);
  expect(await events(page, "message")).toEqual([]);
});

test("Linear disconnect ignores late issue and URL results without reopening the previous issue", async ({
  page,
}) => {
  const authorization = await mockLinearAuthorization(page);
  const ui = app(page);
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  let releaseDetail!: () => void;
  let releaseUrl!: () => void;
  let detailWaiting = false;
  let urlWaiting = false;
  const detailGate = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  const urlGate = new Promise<void>((resolve) => {
    releaseUrl = resolve;
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { issueId?: string };
    };
    if (
      input.name === "linear_get_issue" &&
      input.arguments.issueId === "fixture-linear-43"
    ) {
      const response = await route.fetch();
      detailWaiting = true;
      await detailGate;
      return route.fulfill({ response });
    }
    if (input.name === "linear_resolve_issue") {
      const response = await route.fetch();
      urlWaiting = true;
      await urlGate;
      return route.fulfill({ response });
    }
    return route.fallback();
  });
  try {
    await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
    await expect.poll(() => detailWaiting).toBe(true);
    const search = ui.getByRole("textbox", {
      name: "Search Linear Issues",
      exact: true,
    });
    await search.fill("https://linear.app/fixture/issue/YU-42");
    await search.press("Enter");
    await expect.poll(() => urlWaiting).toBe(true);
    await disconnectLinear(page);
    releaseDetail();
    await expect(ui.getByText("Connect Linear", { exact: true })).toBeVisible();
    const before = (await events(page, "tool")) as { name: string }[];
    releaseUrl();
    await expect
      .poll(
        async () =>
          ((await events(page, "tool-pressure")).at(-1) as { active: number })
            ?.active,
      )
      .toBe(0);
    expect(await events(page, "tool")).toEqual(before);
    await expect(
      ui.getByRole("heading", { name: secondTitle, exact: true }),
    ).toHaveCount(0);
    await expect(
      ui.getByRole("textbox", { name: "Linear comment", exact: true }),
    ).toHaveCount(0);
    expect(authorization.disconnects).toHaveLength(1);
    expect(await events(page, "context")).toEqual([]);
    expect(await events(page, "message")).toEqual([]);
  } finally {
    releaseDetail();
    releaseUrl();
  }
});

test("Linear disconnect stays reachable with no issues or connection errors and reconnects to the current workspace", async ({
  page,
}) => {
  const authorization = await mockLinearAuthorization(page, { empty: true });
  const ui = app(page);
  await expect(
    ui.getByText("No matching Issues.", { exact: true }),
  ).toBeVisible();
  const trigger = ui.getByLabel("Linear connection actions", { exact: true });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(
    ui.getByRole("button", { name: "Disconnect Linear", exact: true }),
  ).toBeHidden();
  await disconnectLinear(page);
  await expect(ui.getByText("Connect Linear", { exact: true })).toBeVisible();
  const before = (await events(page, "tool")).length;
  authorization.connected = true;
  authorization.otherWorkspace = true;
  await ui
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(selectControl(ui, "Linear Team")).toHaveAttribute(
    "data-value",
    "",
  );
  await expect(
    ui.getByText(
      "The selected Linear team is unavailable. Choose a team to continue.",
      { exact: true },
    ),
  ).toBeVisible();
  await choose(ui, "Linear Team", "another-team");
  await expect(selectControl(ui, "Linear Team")).toHaveAttribute(
    "data-value",
    "another-team",
  );
  await expect(
    ui.getByText("Another workspace", { exact: true }),
  ).toBeVisible();
  await expect(
    ui.getByText("No matching Issues.", { exact: true }),
  ).toBeVisible();
  const calls = (
    (await events(page, "tool")) as {
      name: string;
      arguments: Record<string, unknown>;
    }[]
  ).slice(before);
  const scoped = calls.filter((call) =>
    ["linear_metadata", "linear_list_issues", "linear_get_issue"].includes(
      call.name,
    ),
  );
  expect(scoped.length).toBeGreaterThan(0);
  expect(
    scoped.every(
      (call) =>
        call.arguments.workspaceId === "another-workspace" &&
        call.arguments.teamId === "another-team",
    ),
  ).toBe(true);

  authorization.connectionError = true;
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  const connectionError = ui.getByText(
    "The Linear connection is temporarily unavailable.",
    { exact: false },
  );
  await expect(connectionError).toBeVisible();
  await expect(connectionError).toContainText(
    "Check the connection and refresh.",
  );
  const disconnected = page.waitForResponse(
    (response) =>
      response.url().endsWith("/tool") &&
      (response.request().postDataJSON() as { name: string }).name ===
        "linear_auth_disconnect",
  );
  await disconnectLinear(page);
  await (await disconnected).finished();
  await expect(ui.locator(".notice")).toHaveCount(0);
  expect(authorization.disconnects).toHaveLength(2);
});

test("Linear external authorization keeps waiting guidance until a connected workspace is available", async ({
  page,
}) => {
  const authorization = await mockLinearAuthorization(page);
  const ui = app(page);
  await disconnectLinear(page);
  await expect(ui.getByText("Connect Linear", { exact: true })).toBeVisible();
  await ui
    .getByLabel("OAuth client ID", { exact: true })
    .fill("fixture-client");
  await ui
    .getByRole("button", { name: "Authorize in Linear", exact: true })
    .click();
  await expect(ui.getByRole("status")).toHaveText(
    "Complete authorization in Linear, then return to Arco.",
  );
  await expect(ui.locator(".notice")).toHaveCount(0);
  expect(await events(page, "link")).toContainEqual({
    url: "https://linear.app/oauth/authorize",
  });
  authorization.connected = true;
  await ui
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(
    ui.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(
    ui.getByText("Complete authorization in Linear, then return to Arco.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(ui.locator(".notice")).toHaveCount(0);
});

test("Linear mixed bulk outcomes show only failed issues and retry only those failures", async ({
  page,
}) => {
  const calls: string[][] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { issueIds?: string[] };
    };
    if (input.name !== "linear_bulk") return route.continue();
    calls.push(input.arguments.issueIds ?? []);
    if (calls.length !== 1) return route.continue();
    const response = await route.fetch({
      postData: {
        ...input,
        arguments: { ...input.arguments, issueIds: ["fixture-linear-42"] },
      },
    });
    const result = await response.json();
    result.structuredContent.results.push({
      issueId: "fixture-linear-43",
      success: false,
      saved: false,
      retryable: true,
      error: "Fixture permission denied for YU-43",
    });
    return route.fulfill({ response, json: result });
  });
  const ui = app(page);
  for (const number of [42, 43])
    await ui
      .getByRole("checkbox", { name: `YU-${number} — select for bulk actions` })
      .check();
  const bulk = ui.getByRole("region", { name: "Bulk Linear actions" });
  await choose(bulk, "Bulk Linear action", "priority");
  await choose(bulk, "Bulk Linear priority", "4");
  await bulk.getByRole("button", { name: "Apply", exact: true }).click();
  const failures = bulk.getByRole("list", {
    name: "Failed issues",
    exact: true,
  });
  await expect(failures.getByRole("listitem")).toHaveCount(1);
  await expect(failures).toContainText("YU-43");
  await expect(failures).toContainText("Fixture permission denied for YU-43");
  await expect(failures).not.toContainText("fixture-linear-43");
  await expect(failures).not.toContainText("fixture-linear-42");
  await bulk
    .getByRole("button", { name: "Retry failed issues only", exact: true })
    .click();
  await expect(bulk).toHaveCount(0);
  expect(calls).toEqual([
    ["fixture-linear-42", "fixture-linear-43"],
    ["fixture-linear-43"],
  ]);
  await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await expect(selectControl(ui, "Linear Priority")).toHaveAttribute(
    "data-value",
    "4",
  );
  await expect(ui.locator(".notice")).toHaveCount(0);
});
