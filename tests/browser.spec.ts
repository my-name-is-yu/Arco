import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { choose, selectControl } from "./select-helpers";

const firstTitle = "Preserve issue selection and scroll position";
const secondTitle = "Separate shared context from sending a request";
const pageErrors = new WeakMap<Page, string[]>();
function issueFrame(page: Page): FrameLocator {
  return page.frameLocator("#arco");
}
async function openIssueActions(app: FrameLocator) {
  if ((await app.locator(".detail-utilities").getAttribute("open")) === null)
    await app.getByLabel("Issue actions", { exact: true }).click();
}
async function moreProperties(app: FrameLocator) {
  if ((await app.locator(".property-advanced").getAttribute("open")) === null)
    await app.getByText("More properties", { exact: true }).click();
}
async function openMultiSelect(app: FrameLocator, label: string) {
  const trigger = app
    .getByRole("group", { name: label, exact: true })
    .getByRole("button");
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  return trigger;
}
async function events(page: Page, type: string) {
  const log: { type: string; value: unknown }[] = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  );
  return log.filter((event) => event.type === type).map((event) => event.value);
}
function sharedContextFromText(value: unknown) {
  const update = value as {
    content: { type: string; text: string }[];
    structuredContent: Record<string, unknown>;
  };
  expect(update.content).toHaveLength(1);
  expect(update.content[0]!.type).toBe("text");
  const marker = "\n\nIssue context (source data):\n";
  const text = update.content[0]!.text;
  expect(text).toContain(marker);
  const context = JSON.parse(
    text.slice(text.indexOf(marker) + marker.length),
  ) as Record<string, unknown>;
  const { arcoSharedIssue, ...structured } = update.structuredContent;
  expect(arcoSharedIssue).toBe(1);
  expect(context).toEqual(structured);
  return context;
}
test.beforeEach(async ({ page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", (error) => pageErrors.get(page)!.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      document.documentElement.dataset.cspViolations = JSON.stringify([
        ...JSON.parse(document.documentElement.dataset.cspViolations ?? "[]"),
        {
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
          source: event.sourceFile,
          line: event.lineNumber,
          column: event.columnNumber,
        },
      ]);
    });
  });
  await page.goto("/");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await choose(issueFrame(page), "GitHub scope", "yu/Arco");
  await expect(
    issueFrame(page).getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(page.locator("#harness-error")).toBeEmpty();
});
test.afterEach(async ({ page }, testInfo) => {
  const violations = await Promise.all(
    page
      .frames()
      .map((frame) =>
        frame.evaluate(() =>
          JSON.parse(document.documentElement.dataset.cspViolations ?? "[]"),
        ),
      ),
  );
  await testInfo.attach("iframe-csp-violations", {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json",
  });
  expect(violations.flat()).toEqual([]);
  await testInfo.attach("page-errors", {
    body: JSON.stringify(pageErrors.get(page)),
    contentType: "application/json",
  });
  expect(pageErrors.get(page)).toEqual([]);
});

test("fixture edits, comment, and label changes round trip through the real stdio MCP", async ({
  page,
}) => {
  const app = issueFrame(page);
  const preview = app.getByRole("img", { name: "Fixture selection preview" });
  await expect(preview).toBeVisible();
  expect(
    await preview.evaluate(
      (element: HTMLImageElement) =>
        element.complete && element.naturalWidth > 0,
    ),
  ).toBe(true);
  await openIssueActions(app);
  await app.getByRole("button", { name: "Edit issue" }).click();
  await app
    .getByRole("textbox", { name: "Issue title", exact: true })
    .fill("An edited issue");
  await app
    .getByRole("textbox", { name: "Issue body", exact: true })
    .fill("## Saved body\n\nVerify the Markdown update.");
  await app.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    app.getByRole("heading", { name: "An edited issue", exact: true }),
  ).toBeVisible();
  await expect(app.locator(".issue-body")).toContainText(
    "Verify the Markdown update.",
  );
  await app
    .getByRole("textbox", { name: "Comment on GitHub" })
    .fill("A local fixture comment");
  await app.getByRole("button", { name: "Post comment" }).click();
  await expect(
    app.locator(".comment").filter({ hasText: "A local fixture comment" }),
  ).toHaveCount(1);
  await expect(
    app.getByRole("textbox", { name: "Comment on GitHub" }),
  ).toHaveValue("");
  await openMultiSelect(app, "Labels");
  await app.getByRole("option", { name: "bug", exact: true }).click();
  await expect(
    app.getByRole("option", { name: "bug", exact: true }),
  ).toHaveAttribute("data-selected", "");
  await expect(
    app.getByRole("option", { name: "enhancement", exact: true }),
  ).toHaveAttribute("data-selected", "");
  await expect(
    app.getByRole("option", { name: "design", exact: true }),
  ).toHaveAttribute("data-selected", "");
  await page.keyboard.press("Escape");
  await app.getByRole("button", { name: "Refresh", exact: true }).click();
  const labels = app.getByRole("group", { name: "Labels", exact: true });
  await expect(labels).toContainText("bug");
  await expect(labels).toContainText("enhancement");
  await expect(labels).toContainText("design");
  await openIssueActions(app);
  await app.getByRole("button", { name: "Edit issue" }).click();
  await app
    .getByRole("textbox", { name: "Issue body", exact: true })
    .fill("Body editing still works after comment and label changes.");
  await app.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(app.locator(".issue-body")).toContainText(
    "Body editing still works after comment and label changes.",
  );
});

test("GitHub assignees support multiple keyboard choices, Escape, and focus return", async ({
  page,
}) => {
  const app = issueFrame(page);
  const picker = app.getByRole("group", { name: "Assignees", exact: true });
  const trigger = picker.getByRole("button");
  await expect(trigger).toContainText("fixture-user");
  await trigger.focus();
  await page.keyboard.press("j");
  await page.keyboard.press("/");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Space");
  await expect(
    app.getByRole("option", { name: "fixture-user", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    app.getByRole("option", { name: "fixture-reviewer", exact: true }),
  ).toHaveAttribute("data-selected", "");
  await expect(
    app.getByRole("option", { name: "fixture-user", exact: true }),
  ).toHaveAttribute("data-selected", "");
  await expect(trigger).toBeEnabled();
  await page.screenshot({ path: "dist/dev/multi-select-github-fixture.png" });
  await page.keyboard.press("Escape");
  await expect(
    app.getByRole("option", { name: "fixture-reviewer", exact: true }),
  ).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await app.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(trigger).toContainText("fixture-user");
  await expect(trigger).toContainText("fixture-reviewer");
  const writes = (
    (await events(page, "tool")) as {
      name: string;
      arguments: { patch?: unknown };
    }[]
  ).filter((tool) => tool.name === "arco_update_issue");
  expect(writes).toHaveLength(1);
  expect(writes[0]!.arguments.patch).toEqual({
    assignees: ["fixture-user", "fixture-reviewer"],
  });
  expect(await events(page, "message")).toEqual([]);
  expect(await events(page, "context")).toEqual([]);
});

test("pending saves protect inputs until the acknowledged fixture result arrives", async ({
  page,
}) => {
  const app = issueFrame(page);
  let releaseSave: () => void = () => {};
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/tool", async (route) => {
    const data = route.request().postDataJSON() as { name: string };
    if (data.name === "arco_update_issue") await heldSave;
    await route.continue();
  });
  await openIssueActions(app);
  await app.getByRole("button", { name: "Edit issue" }).click();
  await app
    .getByRole("textbox", { name: "Issue body", exact: true })
    .fill("Body protected while saving");
  await app.getByRole("button", { name: "Save changes", exact: true }).click();
  try {
    await expect(
      app.getByRole("textbox", { name: "Issue body", exact: true }),
    ).toBeDisabled();
    await expect(
      app.getByRole("textbox", { name: "Issue title", exact: true }),
    ).toBeDisabled();
  } finally {
    releaseSave();
  }
  await expect(app.locator(".issue-body")).toContainText(
    "Body protected while saving",
  );
});

test("body/comment range sharing carries exactly the selected source text", async ({
  page,
}) => {
  const app = issueFrame(page);
  for (const [selector, origin, text] of [
    [
      ".issue-body p",
      "body",
      "Return to the same position when switching between issues.",
    ],
    [
      '.comment [data-context-origin="comment"] p',
      "comment",
      "Keep the same behavior when switching issues with the keyboard.",
    ],
  ] as const) {
    const paragraph = app.locator(selector).first();
    await paragraph.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await app.getByRole("button", { name: "Share selection" }).click();
    await expect
      .poll(async () => (await events(page, "context")).at(-1))
      .toEqual(
        expect.objectContaining({
          structuredContent: expect.objectContaining({
            selection: expect.objectContaining({ text, origin }),
          }),
        }),
      );
    const context = sharedContextFromText(
      (await events(page, "context")).at(-1),
    );
    expect(context).toMatchObject({
      source: "github",
      repo: "yu/Arco",
      number: 42,
      selection: { text, origin },
    });
    expect(context).not.toHaveProperty("body");
    await app
      .getByRole("button", { name: "Clear selection", exact: true })
      .click();
  }
  expect(await events(page, "message")).toHaveLength(0);
});

test("GitHub replaces a shared body range with a comment range after mouseup on comment padding", async ({
  page,
}) => {
  const app = issueFrame(page);
  await app
    .locator(".issue-body p")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await app
    .getByRole("button", { name: "Share selection", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  expect(
    sharedContextFromText((await events(page, "context"))[0]),
  ).toMatchObject({
    selection: { origin: "body" },
  });

  const selectedComment = await app
    .locator(".comment")
    .first()
    .evaluate((article) => {
      const content = article.querySelector<HTMLElement>(
        '[data-context-origin="comment"]',
      )!;
      const paragraph = content.querySelector("p")!;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      article.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return {
        text: selection.toString(),
        origin: "comment",
        commentId: content.dataset.commentId,
      };
    });
  await expect(app.locator(".selection-preview")).toContainText(
    "Comment selection",
  );
  await expect(app.locator(".selection-preview blockquote")).toHaveText(
    selectedComment.text,
  );
  await app
    .getByRole("button", { name: "Share selection", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  const context = sharedContextFromText((await events(page, "context"))[1]);
  expect(context.selection).toEqual(selectedComment);
  expect(context).not.toHaveProperty("body");
  expect(await events(page, "message")).toEqual([]);
  const tools = (await events(page, "tool")) as {
    arguments: Record<string, unknown>;
  }[];
  expect(tools.filter((tool) => "requestId" in tool.arguments)).toEqual([]);
});

for (const invalidSelection of ["empty", "cross-origin"] as const) {
  test(`GitHub clears a previously shared body range when the new selection is ${invalidSelection}`, async ({
    page,
  }) => {
    const app = issueFrame(page);
    await app
      .locator(".issue-body p")
      .first()
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
    await app
      .getByRole("button", { name: "Share selection", exact: true })
      .click();
    await expect.poll(() => events(page, "context")).toHaveLength(1);

    await app.locator(".detail-scroll").evaluate((element, kind) => {
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      if (kind === "cross-origin") {
        const body = element.querySelector(".issue-body p")!.firstChild!;
        const comment = element.querySelector(
          '.comment [data-context-origin="comment"] p',
        )!.firstChild!;
        const range = document.createRange();
        range.setStart(body, 0);
        range.setEnd(comment, comment.textContent!.length);
        selection.addRange(range);
      }
      element
        .querySelector(".comment")!
        .dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }, invalidSelection);

    await expect(app.locator(".selection-preview")).toHaveCount(0);
    await expect(
      app.getByRole("button", { name: "Share selection", exact: true }),
    ).toHaveCount(0);
    await app.getByRole("button", { name: "Add to chat", exact: true }).click();
    await expect.poll(() => events(page, "context")).toHaveLength(2);
    const context = sharedContextFromText((await events(page, "context"))[1]);
    expect(context).not.toHaveProperty("selection");
    expect(context.body).toContain(
      "Return to the same position when switching between issues.",
    );
    expect(await events(page, "message")).toEqual([]);
    const tools = (await events(page, "tool")) as {
      arguments: Record<string, unknown>;
    }[];
    expect(tools.filter((tool) => "requestId" in tool.arguments)).toEqual([]);
  });
}

test("issue drafts and search survive selection changes; browse never shares", async ({
  page,
}) => {
  const app = issueFrame(page);
  await page.setViewportSize({ width: 1440, height: 600 });
  await app.getByRole("button", { name: "All", exact: true }).click();
  await expect(app.locator(".issue-row")).toHaveCount(3);
  const list = app.locator(".issue-list");
  const scrollTop = await list.evaluate((element) => {
    element.scrollTop = 35;
    return element.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  await app.getByRole("textbox", { name: "Search issues" }).fill("shared");
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await expect(
    app.getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  await expect(app.getByRole("textbox", { name: "Search issues" })).toHaveValue(
    "shared",
  );
  await app.getByRole("textbox", { name: "Search issues" }).fill("");
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBe(scrollTop);
  await app.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await openIssueActions(app);
  await app.getByRole("button", { name: "Edit issue" }).click();
  await app
    .getByRole("textbox", { name: "Issue body", exact: true })
    .fill("Keep this unsaved body draft");
  await app
    .getByRole("textbox", { name: "Comment on GitHub" })
    .fill("An unsent comment draft");
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await app.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await openIssueActions(app);
  await app.getByRole("button", { name: "Edit issue" }).click();
  await expect(
    app.getByRole("textbox", { name: "Issue body", exact: true }),
  ).toHaveValue("Keep this unsaved body draft");
  await expect(
    app.getByRole("textbox", { name: "Comment on GitHub" }),
  ).toHaveValue("An unsent comment draft");
  expect(await events(page, "context")).toHaveLength(0);
  expect(await events(page, "message")).toHaveLength(0);
});

test("context, current/new drafts, explicit send, and mock mentions remain separate", async ({
  page,
}) => {
  const app = issueFrame(page);
  await app.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const sharedContext = sharedContextFromText(
    (await events(page, "context"))[0],
  );
  expect(sharedContext).toMatchObject({
    source: "github",
    repo: "yu/Arco",
    number: 42,
    title: firstTitle,
  });
  expect(sharedContext.body).toContain(
    "Return to the same position when switching between issues.",
  );
  expect(sharedContext).not.toHaveProperty("selection");
  const explicitContext = await events(page, "context");
  expect(await events(page, "message")).toHaveLength(0);
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await expect(app.locator(".shared-target")).toContainText("yu/Arco #42");
  await expect(app.locator(".shared-target")).toContainText(
    "Different from the issue you are browsing",
  );
  await app.getByRole("button", { name: "Ask Codex", exact: true }).click();
  await app
    .getByRole("textbox", { name: "Request for Codex" })
    .fill("Consider an implementation plan for this issue");
  await app.getByRole("button", { name: "Prepare draft", exact: true }).click();
  await expect.poll(() => events(page, "message")).toHaveLength(1);
  await choose(app, "Target chat", "new");
  await app.getByRole("button", { name: "Prepare draft", exact: true }).click();
  await expect.poll(() => events(page, "message")).toHaveLength(2);
  await app.getByRole("button", { name: "Send request", exact: true }).click();
  await expect.poll(() => events(page, "message")).toHaveLength(3);
  await choose(app, "Target chat", "self");
  await app.getByRole("button", { name: "Send request", exact: true }).click();
  await expect.poll(() => events(page, "message")).toHaveLength(4);
  const messages = await events(page, "message");
  expect(messages).toEqual([
    expect.objectContaining({
      _meta: { "openai/message": { target: "active", send: false } },
    }),
    expect.objectContaining({
      _meta: { "openai/message": { target: "new", send: false } },
    }),
    expect.objectContaining({
      _meta: { "openai/message": { target: "new", send: true } },
    }),
    expect.objectContaining({
      _meta: { "openai/message": { target: "active", send: true } },
    }),
  ]);
  for (const message of messages as { content: { text: string }[] }[])
    expect(message.content[0]!.text).toContain(secondTitle);
  expect(await events(page, "context")).toEqual(explicitContext);
  await expect(app.locator(".shared-target")).toContainText("yu/Arco #42");
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(
    app
      .locator(".inline-mode")
      .getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await app.getByRole("button", { name: "Open details", exact: true }).click();
  await expect(
    app.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  expect(await events(page, "context")).toEqual(explicitContext);
  await page
    .getByRole("textbox", { name: "Mock @Arco search" })
    .fill("repo:yu/Arco shared");
  await page.getByRole("button", { name: "Mock @Arco search" }).click();
  await expect
    .poll(() => events(page, "mentions"))
    .toEqual([
      expect.objectContaining({
        items: [
          expect.objectContaining({ resourceUri: "issue://github/yu/Arco/43" }),
        ],
      }),
    ]);
});

test("external MCP update refreshes the existing iframe, and display modes use the bridge", async ({
  page,
}) => {
  const app = issueFrame(page);
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  const frameHandle = await frame.evaluate(() => {
    document.documentElement.dataset.instance = crypto.randomUUID();
    return document.documentElement.dataset.instance;
  });
  await app
    .getByRole("textbox", { name: "Comment on GitHub" })
    .fill("Keep this draft during refresh");
  await page.getByRole("button", { name: "Mock external update #42" }).click();
  await expect(
    app.getByRole("heading", {
      name: "Issue updated by a Codex tool",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    app.getByRole("textbox", { name: "Comment on GitHub" }),
  ).toHaveValue("Keep this draft during refresh");
  expect(
    await frame.evaluate(() => document.documentElement.dataset.instance),
  ).toBe(frameHandle);
  await app.getByRole("button", { name: "Add to chat", exact: true }).click();
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(app.locator(".inline-mode")).toBeVisible();
  await expect(
    app.getByRole("heading", {
      name: "Issue updated by a Codex tool",
      exact: true,
    }),
  ).toBeVisible();
  await app.getByRole("button", { name: "Open details", exact: true }).click();
  await expect(app.locator(".workspace")).toBeVisible();
  await expect(
    app.getByRole("heading", {
      name: "Issue updated by a Codex tool",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect
    .poll(() => events(page, "display"))
    .toEqual(["fullscreen", "inline", "fullscreen", "inline"]);
});

test("an inline card reports a host fullscreen fallback and keeps shared context and drafts for retry", async ({
  page,
}) => {
  const app = issueFrame(page);
  await app.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const explicitContext = await events(page, "context");
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await app
    .getByRole("textbox", { name: "Comment on GitHub" })
    .fill("Keep this unsent draft when the host refuses fullscreen");
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(
    app
      .locator(".inline-mode")
      .getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  const fallback = page.getByRole("checkbox", {
    name: "Mock keep current display mode",
    exact: true,
  });
  await fallback.check();
  await app.getByRole("button", { name: "Open details", exact: true }).click();
  await expect(app.getByRole("alert")).toHaveText(
    "The host could not switch to fullscreen mode. It kept inline mode.",
  );
  await expect(app.locator(".inline-mode")).toBeVisible();
  await expect(app.locator(".workspace")).toHaveCount(0);
  await expect(
    app.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  expect(await events(page, "context")).toEqual(explicitContext);
  expect(await events(page, "message")).toEqual([]);
  await fallback.uncheck();
  await app.getByRole("button", { name: "Open details", exact: true }).click();
  await expect(app.locator(".workspace")).toBeVisible();
  await expect(app.locator(".issue-row.selected")).toContainText(firstTitle);
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await expect(
    app.getByRole("textbox", { name: "Comment on GitHub" }),
  ).toHaveValue("Keep this unsent draft when the host refuses fullscreen");
  expect(await events(page, "context")).toEqual(explicitContext);
  expect(await events(page, "message")).toEqual([]);
  expect(await events(page, "display-request")).toEqual([
    { requested: "fullscreen", actual: "inline" },
    { requested: "fullscreen", actual: "fullscreen" },
  ]);
});

test("presentation changes preserve the GitHub draft without tool calls", async ({
  page,
}) => {
  const app = issueFrame(page);
  await expect(
    app.getByRole("img", { name: "Fixture selection preview" }),
  ).toBeVisible();
  const comment = app.getByRole("textbox", { name: "Comment on GitHub" });
  const draft = "Keep this unsent GitHub comment while resizing";
  await comment.fill(draft);
  await expect(
    app.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        ((await events(page, "tool-pressure")) as { active: number }[]).at(-1)
          ?.active,
    )
    .toBe(0);
  const before = await events(page, "tool");
  for (let count = 0; count < 24; count += 1)
    await page
      .getByRole("button", { name: "Mock fullscreen", exact: true })
      .click();
  for (const size of [
    { width: 760, height: 1000 },
    { width: 1100, height: 700 },
    { width: 1920, height: 1080 },
    { width: 566, height: 826 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    await page.getByText("Mock host events", { exact: true }).click();
    await page
      .getByRole("button", { name: "Mock presentation updates" })
      .click();
    await page.getByText("Mock host events", { exact: true }).click();
  }
  // Let the host's data-notification coalescing window settle.
  await page.waitForTimeout(350);
  expect(await events(page, "tool")).toEqual(before);
  await expect(comment).toHaveValue(draft);
  await expect(
    app.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(app.getByText(/request queue is full/)).toHaveCount(0);
  expect(await events(page, "message")).toEqual([]);
  expect(await events(page, "context")).toEqual([]);
});

test("GitHub refresh failures keep cached issue content and drafts usable until retry succeeds", async ({
  page,
}) => {
  const app = issueFrame(page);
  await app
    .getByRole("textbox", { name: "Comment on GitHub" })
    .fill("Keep this unsent comment when the host queue is full");
  let fail = true;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_get_issue" || !fail) return route.continue();
    return route.fulfill({
      json: {
        isError: true,
        content: [
          {
            type: "text",
            text: "MCP error -32001: App server request queue is full",
          },
        ],
      },
    });
  });
  await app.getByRole("button", { name: "Refresh", exact: true }).click();
  const refreshError = app
    .getByRole("alert")
    .filter({ hasText: "Could not refresh this issue." });
  await expect(refreshError).toContainText("Showing the last loaded version.");
  await expect(refreshError).toContainText("App server request queue is full");
  await expect(
    app.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(app.locator(".detail-pane > .empty-state")).toHaveCount(0);
  await expect(
    app.getByRole("textbox", { name: "Comment on GitHub" }),
  ).toHaveValue("Keep this unsent comment when the host queue is full");
  fail = false;
  await refreshError
    .getByRole("button", { name: "Retry refresh", exact: true })
    .click();
  await expect(refreshError).toHaveCount(0);
  await expect(
    app.getByRole("textbox", { name: "Comment on GitHub" }),
  ).toHaveValue("Keep this unsent comment when the host queue is full");
  const tools = (await events(page, "tool")) as {
    arguments: Record<string, unknown>;
  }[];
  expect(tools.filter((tool) => "requestId" in tool.arguments)).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
  expect(await events(page, "context")).toEqual([]);
});

test("visible source refetch reflects an external mutation without a host notification", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const app = issueFrame(page);
  const requested = page.waitForRequest(
    (request) =>
      request.url().endsWith("/tool") &&
      request.method() === "POST" &&
      request.postDataJSON().name === "arco_get_issue",
  );
  await app.getByRole("button", { name: "Refresh", exact: true }).click();
  const { session } = (await requested).postDataJSON() as { session: string };
  const response = await page.request.post("/tool", {
    data: {
      session,
      name: "arco_update_issue",
      arguments: {
        repo: "yu/Arco",
        number: 42,
        requestId: "silent-source-update",
        patch: { title: "Updated without a bridge event" },
      },
    },
  });
  expect((await response.json()).isError).toBeUndefined();
  await expect(
    app.getByRole("heading", {
      name: "Updated without a bridge event",
      exact: true,
    }),
  ).toBeVisible({ timeout: 35_000 });
  expect(await events(page, "external-update")).toEqual([]);
});

test("keyboard navigation and narrow panel remain usable; capture wide/narrow mock views", async ({
  page,
}, testInfo) => {
  const app = issueFrame(page);
  await page.screenshot({
    path: testInfo.outputPath("arco-wide.png"),
    fullPage: true,
  });
  await app.getByRole("heading", { name: firstTitle, exact: true }).click();
  await page.keyboard.press("j");
  await expect(
    app.getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("k");
  await expect(
    app.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("/");
  await expect(
    app.getByRole("textbox", { name: "Search issues" }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(app.getByRole("button", { name: "Back to list" })).toBeVisible();
  await expect(
    app.getByRole("button", { name: "Add to chat", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("arco-narrow.png"),
    fullPage: true,
  });
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  expect(
    await frame.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await app.getByRole("button", { name: "Back to list" }).click();
  await expect(
    app.getByRole("textbox", { name: "Search issues" }),
  ).toBeVisible();
});

test("bulk changes keep per-Issue results and report partial permission failures", async ({
  page,
}) => {
  const app = issueFrame(page);
  await app
    .getByRole("checkbox", { name: "Select yu/Arco #42 for bulk actions" })
    .check();
  await app
    .getByRole("checkbox", { name: "Select yu/Arco #43 for bulk actions" })
    .check();
  await page.route("**/tool", async (route) => {
    const body = route.request().postDataJSON() as {
      name: string;
      arguments?: { number?: number };
    };
    if (body.name === "arco_update_issue" && body.arguments?.number === 43) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          isError: true,
          content: [
            { type: "text", text: "Fixture permission denied for #43" },
          ],
        }),
      });
    } else await route.continue();
  });
  await app
    .getByRole("button", { name: "Apply to 2 issues", exact: true })
    .click();
  await expect(app.locator(".bulk-results")).toContainText(
    "yu/Arco #42 Saved and refreshed",
  );
  await expect(app.locator(".bulk-results")).toContainText(
    "Fixture permission denied for #43",
  );
  await app.getByRole("button", { name: "Closed", exact: true }).click();
  await expect(
    app.locator(".issue-row").filter({ hasText: firstTitle }),
  ).toBeVisible();
  await app.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    app.locator(".issue-row").filter({ hasText: secondTitle }),
  ).toBeVisible();
});

test("Markdown tasks, comment edits, reactions, and label definitions use explicit source writes", async ({
  page,
}) => {
  const app = issueFrame(page);
  const task = app.getByRole("checkbox", {
    name: "Completion of Preserve filters, selection, and scroll position",
    exact: true,
  });
  await expect(task).not.toBeChecked();
  await task.click();
  await expect(task).toBeChecked();
  await openIssueActions(app);
  await app.getByRole("button", { name: "Edit issue" }).click();
  await expect(
    app.getByRole("textbox", { name: "Issue body", exact: true }),
  ).toHaveValue(/- \[x\] Preserve filters, selection, and scroll position/);
  await app.getByRole("button", { name: "Close", exact: true }).click();
  await app
    .getByRole("textbox", { name: "Comment on GitHub" })
    .fill("A fixture comment to edit");
  await app.getByRole("button", { name: "Post comment", exact: true }).click();
  const comment = app
    .locator(".comment")
    .filter({ hasText: "A fixture comment to edit" });
  await comment.getByRole("button", { name: "Edit", exact: true }).click();
  await comment
    .getByRole("textbox", { name: "Edit comment", exact: true })
    .fill("An edited fixture comment");
  await comment
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect(
    app.locator(".comment").filter({ hasText: "An edited fixture comment" }),
  ).toHaveCount(1);
  await app
    .getByRole("button", { name: "Choose reaction", exact: true })
    .first()
    .click();
  await app
    .getByRole("button", { name: "heart 0 Add reaction", exact: true })
    .first()
    .click();
  await expect(
    app
      .getByRole("button", {
        name: "heart 1 Remove my reaction",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await app
    .getByRole("button", {
      name: "heart 1 Remove my reaction",
      exact: true,
    })
    .first()
    .click();
  await expect(
    app
      .getByRole("button", {
        name: "heart 0 Add reaction",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await moreProperties(app);
  await app.getByText("Manage label definitions", { exact: true }).click();
  const manager = app.locator(".label-manager");
  const labelName = 'Quotes "native" \\ path';
  await manager
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(labelName);
  await manager
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Label definition verification");
  await manager
    .getByRole("button", { name: "Create label", exact: true })
    .click();
  const definition = manager
    .locator(".definition-list li")
    .filter({ hasText: labelName });
  await expect(definition).toBeVisible();
  await app
    .getByRole("checkbox", { name: "Select yu/Arco #42 for bulk actions" })
    .check();
  const bulk = app.getByRole("region", { name: "Bulk issue actions" });
  await choose(bulk, "Bulk action", "label-add");
  const value = selectControl(bulk, "Bulk value");
  const trigger = value.getByRole("button");
  await trigger.focus();
  await page.keyboard.press("Space");
  await expect(
    app.getByRole("option", { name: labelName, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("q");
  await page.keyboard.press("Enter");
  await expect(value).toHaveAttribute("data-value", labelName);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Space");
  await expect(
    app.getByRole("option", { name: labelName, exact: true }),
  ).toHaveAttribute("data-selected", "");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await bulk
    .getByRole("button", { name: "Apply to 1 issues", exact: true })
    .click();
  await expect(bulk.locator(".bulk-results")).toContainText(
    "yu/Arco #42 Saved and refreshed",
  );
  expect(await events(page, "tool")).toContainEqual(
    expect.objectContaining({
      name: "arco_change_labels",
      arguments: expect.objectContaining({ add: [labelName], remove: [] }),
    }),
  );
  await expect(
    app.getByRole("group", { name: "Labels", exact: true }),
  ).toContainText(labelName);
  await bulk
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await definition
    .getByRole("button", { name: "Delete definition", exact: true })
    .click();
  await expect(manager).toContainText(
    "This removes the label from every issue",
  );
  await manager
    .getByRole("textbox", { name: "Confirm label name to delete" })
    .fill(labelName);
  await manager
    .getByRole("button", {
      name: "Delete repository label definition",
      exact: true,
    })
    .click();
  await expect(definition).toHaveCount(0);
});

test("typed Issue and Project fields, membership without Status, and relations round trip", async ({
  page,
}) => {
  const app = issueFrame(page);
  await moreProperties(app);
  await app
    .getByText("Edit attributes and membership", { exact: true })
    .click();
  await choose(app, "Change milestone", "1");
  await expect(selectControl(app, "Change milestone")).toHaveAttribute(
    "data-value",
    "1",
  );
  await choose(app, "Change issue type", "2");
  await expect(selectControl(app, "Change issue type")).toHaveAttribute(
    "data-value",
    "2",
  );
  const summary = app
    .locator(".field-editor")
    .filter({ has: app.getByText("Summary", { exact: true }) });
  await summary
    .getByRole("textbox", { name: "Summary value" })
    .fill("A field saved to the source");
  await summary.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    summary.getByRole("textbox", { name: "Summary value" }),
  ).toHaveValue("A field saved to the source");
  const area = app
    .locator(".field-editor")
    .filter({ has: app.getByRole("group", { name: "Area", exact: true }) });
  await openMultiSelect(app, "Area");
  await app.getByRole("option", { name: "Frontend", exact: true }).click();
  await app.getByRole("option", { name: "Server", exact: true }).click();
  await page.keyboard.press("Escape");
  const fieldWrites = async () =>
    (
      (await events(page, "tool")) as {
        name: string;
        arguments: { fieldId?: number; value?: unknown };
      }[]
    ).filter(
      (tool) =>
        tool.name === "arco_set_issue_field" && tool.arguments.fieldId === 105,
    );
  expect(await fieldWrites()).toEqual([]);
  await area.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await fieldWrites()).length).toBe(1);
  expect((await fieldWrites())[0]!.arguments.value).toEqual([
    "Frontend",
    "Server",
  ]);
  await expect(
    area.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(
    area.getByRole("group", { name: "Area", exact: true }),
  ).toContainText("Frontend, Server");
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_issue_fields") return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    const field = result.structuredContent.fields.find(
      (field: { id: number }) => field.id === 105,
    );
    field.options = field.options.filter(
      (option: { name: string }) => option.name !== "Frontend",
    );
    await route.fulfill({ response, json: result });
  });
  await app.getByRole("button", { name: "Refresh", exact: true }).click();
  await openMultiSelect(app, "Area");
  const fieldMenu = app.getByRole("dialog");
  await expect(
    fieldMenu.getByRole("option", { name: "Frontend", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await fieldMenu.getByRole("option", { name: "Server", exact: true }).click();
  await page.keyboard.press("Escape");
  await area.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await fieldWrites()).length).toBe(2);
  expect((await fieldWrites())[1]!.arguments.value).toEqual(["Frontend"]);
  await expect(
    area.getByRole("group", { name: "Area", exact: true }),
  ).toContainText("Frontend");
  await choose(app, "Project to add", "fixture-project-notes");
  await app
    .getByRole("button", { name: "Add this issue", exact: true })
    .click();
  const project = app
    .locator(".project-membership")
    .filter({ hasText: "Research notes" });
  await project.locator("summary").click();
  await project
    .getByRole("textbox", { name: "Notes value" })
    .fill("A field in a Project without Status");
  await project
    .locator(".field-editor")
    .filter({ has: app.getByText("Notes", { exact: true }) })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    project.getByRole("textbox", { name: "Notes value" }),
  ).toHaveValue("A field in a Project without Status");
  await moreProperties(app);
  await app
    .getByText("Parent, sub-issues, and dependencies", { exact: true })
    .click();
  const relations = app.locator(".relations-manager");
  await relations
    .getByRole("spinbutton", { name: "Related issue number" })
    .fill("43");
  await relations
    .getByRole("button", { name: "Save relationship", exact: true })
    .click();
  await expect(relations.locator(".relation-list").nth(2)).toContainText(
    "yu/Arco #43",
  );
  await choose(app, "Relationship to add", "child");
  await relations
    .getByRole("spinbutton", { name: "Related issue number" })
    .fill("43");
  await relations
    .getByRole("button", { name: "Save relationship", exact: true })
    .click();
  await expect(relations.locator(".relation-list").nth(1)).toContainText(
    "yu/Arco #43",
  );
  await relations
    .getByRole("button", { name: "Create a sub-issue", exact: true })
    .click();
  await relations
    .getByRole("textbox", { name: "Sub-issue title", exact: true })
    .fill("Keep this child creation draft");
  await relations
    .getByRole("textbox", { name: "Sub-issue body", exact: true })
    .fill("Unsent child description");
  await relations
    .getByRole("textbox", { name: "Sub-issue repository", exact: true })
    .fill("other/Arco");
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await app.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await moreProperties(app);
  await app
    .getByText("Parent, sub-issues, and dependencies", { exact: true })
    .click();
  await relations
    .getByRole("button", { name: "Create a sub-issue", exact: true })
    .click();
  await expect(
    relations.getByRole("textbox", { name: "Sub-issue title", exact: true }),
  ).toHaveValue("Keep this child creation draft");
  await expect(
    relations.getByRole("textbox", { name: "Sub-issue body", exact: true }),
  ).toHaveValue("Unsent child description");
  await expect(
    relations.getByRole("textbox", {
      name: "Sub-issue repository",
      exact: true,
    }),
  ).toHaveValue("other/Arco");
});

test("template menus navigate from and back to an empty selection with keyboard focus", async ({
  page,
}) => {
  const app = issueFrame(page);
  await app.getByRole("button", { name: "Create issue", exact: true }).click();
  const dialog = app.getByRole("dialog", { name: "Create issue", exact: true });
  const template = selectControl(dialog, "Issue template");
  const trigger = template.getByRole("button");
  await expect(trigger).toHaveAttribute("aria-disabled", "false");
  await expect(template).toHaveAttribute("data-value", "");
  await trigger.focus();
  await page.keyboard.press("Space");
  await expect(
    app.getByRole("option", { name: "No template", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(template).toHaveAttribute(
    "data-value",
    ".github/ISSUE_TEMPLATE/bug.md",
  );
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Apply template", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(template).toHaveAttribute("data-value", "");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Apply template", exact: true }),
  ).toHaveCount(0);
});

test("simple templates include visible defaults and complex forms hand off to GitHub", async ({
  page,
}) => {
  const app = issueFrame(page);
  await app.getByRole("button", { name: "Create issue", exact: true }).click();
  const dialog = app.getByRole("dialog", { name: "Create issue" });
  await choose(app, "Issue template", {
    label: "Feature request form · Create on GitHub",
  });
  await expect(
    dialog.getByRole("button", {
      name: "Open this template on GitHub",
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply template", exact: true }),
  ).toHaveCount(0);
  await choose(app, "Issue template", { label: "Bug report" });
  await dialog
    .getByRole("button", { name: "Apply template", exact: true })
    .click();
  await expect(dialog.locator(".template-defaults")).toContainText("bug");
  await expect(
    dialog.getByRole("button", { name: "Issue type: Bug ×", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Body", exact: true }),
  ).toHaveValue(/Steps to reproduce/);
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Fixture created from a template");
  await expect(dialog.locator(".draft-storage-status")).toContainText(
    "Draft saved on this device",
  );
  await page.keyboard.press("Escape");
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await app.getByRole("button", { name: "Create issue", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Issue type: Bug ×", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Fixture created from a template");
  await dialog
    .getByRole("button", { name: "Create fixture issue", exact: true })
    .click();
  await expect(
    app.getByRole("heading", {
      name: "Fixture created from a template",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    app.getByRole("group", { name: "Labels", exact: true }),
  ).toContainText("bug");
  await moreProperties(app);
  await app
    .getByText("Edit attributes and membership", { exact: true })
    .click();
  await expect(selectControl(app, "Change issue type")).toHaveAttribute(
    "data-value",
    "2",
  );
  const creates = (
    (await events(page, "tool")) as {
      name: string;
      arguments: Record<string, unknown>;
    }[]
  ).filter((call) => call.name === "arco_create_issue");
  expect(creates.at(-1)?.arguments.issueTypeName).toBe("Bug");
});

test("scoped issue and creation drafts plus filter settings restore after iframe reload", async ({
  page,
}) => {
  const app = issueFrame(page);
  await app.getByRole("textbox", { name: "Search issues" }).fill("selection");
  await openIssueActions(app);
  await app.getByRole("button", { name: "Edit issue" }).click();
  await app
    .getByRole("textbox", { name: "Issue body", exact: true })
    .fill("A locally saved unsent body");
  await app
    .getByRole("textbox", { name: "Comment on GitHub" })
    .fill("A locally saved comment draft");
  await expect(
    app.locator(".detail-pane > .draft-storage-status"),
  ).toContainText("saved on this device");
  await app.getByRole("button", { name: "Create issue", exact: true }).click();
  const dialog = app.getByRole("dialog", { name: "Create issue" });
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("An uncreated issue draft");
  await dialog
    .getByRole("textbox", { name: "Body", exact: true })
    .fill("A body not yet created on the source");
  await expect(dialog.locator(".draft-storage-status")).toContainText(
    "saved on this device",
  );
  await dialog
    .getByRole("button", { name: "Close create issue", exact: true })
    .click();
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await expect(
    app.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(app.getByRole("textbox", { name: "Search issues" })).toHaveValue(
    "selection",
  );
  await openIssueActions(app);
  await app.getByRole("button", { name: "Edit issue" }).click();
  await expect(
    app.getByRole("textbox", { name: "Issue body", exact: true }),
  ).toHaveValue("A locally saved unsent body");
  await expect(
    app.getByRole("textbox", { name: "Comment on GitHub" }),
  ).toHaveValue("A locally saved comment draft");
  await app.getByRole("button", { name: "Create issue", exact: true }).click();
  await expect(
    dialog.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("An uncreated issue draft");
  await expect(
    dialog.getByRole("textbox", { name: "Body", exact: true }),
  ).toHaveValue("A body not yet created on the source");
  expect(await events(page, "message")).toHaveLength(0);
  expect(await events(page, "context")).toHaveLength(0);
});

test("existing-comment edit drafts survive an immediate Issue switch", async ({
  page,
}) => {
  const app = issueFrame(page);
  await app
    .locator(".comment")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await app
    .getByRole("textbox", { name: "Edit comment", exact: true })
    .fill("Keep this existing-comment edit draft");
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await app.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await app
    .locator(".comment")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(
    app.getByRole("textbox", { name: "Edit comment", exact: true }),
  ).toHaveValue("Keep this existing-comment edit draft");
  expect(await events(page, "message")).toHaveLength(0);
});

test("external content changes preserve the local draft and require an explicit conflict resolution", async ({
  page,
}) => {
  const app = issueFrame(page);
  await openIssueActions(app);
  await app.getByRole("button", { name: "Edit issue" }).click();
  await app
    .getByRole("textbox", { name: "Issue body", exact: true })
    .fill("Keep this local body");
  await page
    .getByRole("button", { name: "Mock external update #42", exact: true })
    .click();
  await expect(
    app.getByRole("textbox", { name: "Issue body", exact: true }),
  ).toHaveValue("Keep this local body");
  await expect(
    app.getByRole("textbox", { name: "Issue title", exact: true }),
  ).toHaveValue("Issue updated by a Codex tool");
  await expect(
    app.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await app
    .getByRole("button", { name: "Compare latest content", exact: true })
    .click();
  await expect(app.locator(".latest-content")).toContainText(
    "The source update was fetched into the same UI.",
  );
  await app
    .getByRole("button", {
      name: "Keep draft and use latest revision",
      exact: true,
    })
    .click();
  await app.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(app.locator(".issue-body")).toContainText(
    "Keep this local body",
  );
  await expect(
    app.getByRole("heading", {
      name: "Issue updated by a Codex tool",
      exact: true,
    }),
  ).toBeVisible();
  expect(await events(page, "message")).toHaveLength(0);
});

test("compact GitHub resolves the account feed when no default or saved repository exists", async ({
  page,
}) => {
  const app = issueFrame(page);
  let accountRead = false;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "arco_account_issues") accountRead = true;
    if (!["arco_connection", "arco_get_settings"].includes(input.name)) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const result = await response.json();
    if (input.name === "arco_connection")
      result.structuredContent.defaultRepo = null;
    else result.structuredContent.settings.activeGithubRepo = null;
    await route.fulfill({ response, json: result });
  });
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(
    app.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(app.getByText("Loading issue…", { exact: true })).toHaveCount(0);
  expect(accountRead).toBe(true);
  await app.getByRole("button", { name: "Open details", exact: true }).click();
  await expect(app.locator(".workspace")).toBeVisible();
  await expect(selectControl(app, "GitHub scope")).toHaveAttribute(
    "data-value",
    "yu/Arco",
  );
  await expect(
    app
      .locator(".detail-pane")
      .getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => events(page, "display"))
    .toEqual(["fullscreen", "inline", "fullscreen"]);
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
});

test("compact GitHub empty closed and all filters show an empty result instead of loading", async ({
  page,
}) => {
  const app = issueFrame(page);
  let state: "closed" | "all" = "closed";
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_get_settings") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const result = await response.json();
    result.structuredContent.settings.activeGithubRepo = "yu/Arco";
    result.structuredContent.settings.githubFilters["yu/Arco"] = {
      query: "no-such-compact-fixture-issue",
      state,
      sort: "updated",
      order: "desc",
    };
    await route.fulfill({ response, json: result });
  });
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  for (const filterState of ["closed", "all"] as const) {
    state = filterState;
    await frame.goto(frame.url());
    await expect(
      app.getByText("No issues match these filters.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Mock inline", exact: true })
      .click();
    await expect(
      app.getByRole("heading", { name: "No matching issues", exact: true }),
    ).toBeVisible();
    await expect(app.locator(".compact-summary")).toHaveText(
      `yu/Arco · ${state === "all" ? "All states" : "Closed"} · no-such-compact-fixture-issue`,
    );
    await expect(app.getByText("Loading issue…", { exact: true })).toHaveCount(
      0,
    );
    await app
      .getByRole("button", { name: "Open issue list", exact: true })
      .click();
    await expect(app.locator(".workspace")).toBeVisible();
    await expect(
      app.getByRole("button", {
        name: state === "all" ? "All" : "Closed",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
});

test("compact GitHub keeps connection loading and errors distinct from repository onboarding", async ({
  page,
}) => {
  const app = issueFrame(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_connection") {
      await route.continue();
      return;
    }
    await held;
    await route.fulfill({
      status: 200,
      json: {
        isError: true,
        content: [
          { type: "text", text: "Fixture GitHub connection check failed" },
        ],
      },
    });
  });
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  try {
    await expect(app.getByRole("status")).toHaveText("Loading issue…");
    await expect(
      app.getByRole("button", { name: "Choose repository", exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
  await expect(app.getByRole("alert")).toHaveText(
    "Fixture GitHub connection check failed",
  );
  await expect(app.getByText("Loading issue…", { exact: true })).toHaveCount(0);
  await expect(
    app.getByRole("button", { name: "Choose repository", exact: true }),
  ).toHaveCount(0);
});

test("shared GitHub selection survives host view recreation in an inline card and Open details", async ({
  page,
}) => {
  const app = issueFrame(page);
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await app
    .locator(".issue-body p")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await app
    .getByRole("button", { name: "Share selection", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  await app.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(app.locator(".inline-mode")).toBeVisible();
  await frame.goto(frame.url());
  await expect(
    app.getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  await expect(app.getByText("Shared issue", { exact: true })).toBeVisible();
  await app.getByRole("button", { name: "Open details", exact: true }).click();
  await expect
    .poll(async () => (await events(page, "display")).at(-1))
    .toBe("fullscreen");
  await frame.goto(frame.url());
  await expect(app.locator(".workspace")).toBeVisible();
  await expect(
    app.getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  await expect(app.locator(".issue-row.selected")).toContainText(secondTitle);
  await choose(app, "Issue source", "linear");
  await expect(
    app.getByRole("heading", {
      name: "Keep Linear workflow states intact",
      exact: true,
    }),
  ).toBeVisible();
  await choose(app, "Issue source", "github");
  await expect(
    app.getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  expect(await events(page, "context")).toHaveLength(1);
  expect(await events(page, "message")).toEqual([]);
});

test("detail toolbar stays visible and utilities support keyboard and clipboard fallback", async ({
  page,
}) => {
  const app = issueFrame(page);
  await page.setViewportSize({ width: 1440, height: 650 });
  await app.locator(".detail-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    app.getByRole("button", { name: "Add to chat", exact: true }),
  ).toBeInViewport();
  await expect(
    app.getByRole("button", { name: "Ask Codex", exact: true }),
  ).toBeInViewport();
  const summary = app.getByLabel("Issue actions", { exact: true });
  const utilities = app.locator(".detail-utilities");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(
    utilities.getByRole("button", { name: "Edit issue", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(summary).toBeFocused();
  expect(await utilities.getAttribute("open")).toBeNull();
  await summary.press("Enter");
  await utilities
    .getByRole("button", { name: "Edit issue", exact: true })
    .click();
  await expect(
    app.getByRole("textbox", { name: "Issue body", exact: true }),
  ).toBeVisible();
  expect(await utilities.getAttribute("open")).toBeNull();
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Fixture clipboard denied");
        },
      },
    }),
  );
  await openIssueActions(app);
  await utilities
    .getByRole("button", { name: "Copy link", exact: true })
    .click();
  await expect(
    utilities.getByRole("textbox", { name: "Value to copy", exact: true }),
  ).toHaveValue("https://github.com/yu/Arco/issues/42");
  expect(await utilities.getAttribute("open")).not.toBeNull();
  await page.keyboard.press("Escape");
  await expect(summary).toBeFocused();
  expect(
    await app.locator(".property-advanced").getAttribute("open"),
  ).toBeNull();
  await moreProperties(app);
  await expect(
    app.getByText("Edit attributes and membership", { exact: true }),
  ).toBeVisible();
  expect(await events(page, "context")).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
});
