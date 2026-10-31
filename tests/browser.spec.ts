import { toolFailure } from "./tool-failure";
import { expectDraftWrite, observeDraftWrites } from "./draft-helpers";
import { expect, test, type FrameLocator, type Page } from "./browser-test";
import { choose, selectControl } from "./select-helpers";
import { checkMarkdownSecurity } from "./markdown-security-helpers";
import type { Comment, IssueDetail } from "../src/shared/contracts";
import {
  sharedContextFromText,
  latestSharedSelection,
  type SharedAnnotation,
} from "./shared-context-helpers";

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
function selectionToolbar(app: FrameLocator) {
  return app.getByRole("toolbar", { name: "Text selection", exact: true });
}
function selectionComment(app: FrameLocator) {
  return app.getByRole("dialog", { name: "Selection comment", exact: true });
}
async function retainedSelection(app: FrameLocator) {
  return app.locator("body").evaluate(() => {
    const registry = (
      CSS as typeof CSS & {
        highlights: { get(name: string): Iterable<Range> | undefined };
      }
    ).highlights;
    return Array.from(registry.get("arco-selection") ?? []).map((range) =>
      range.toString(),
    );
  });
}
async function updateHostContext(page: Page, params: Record<string, unknown>) {
  await page.evaluate((params) => {
    document
      .querySelector<HTMLIFrameElement>("#arco")!
      .contentWindow!.postMessage(
        {
          jsonrpc: "2.0",
          method: "ui/notifications/host-context-changed",
          params,
        },
        "*",
      );
  }, params);
}
async function selectText(app: FrameLocator, selector: string) {
  if (await selectionComment(app).isVisible())
    await selectionComment(app).press("Escape");
  const element = app.locator(selector).first();
  await element.scrollIntoViewIfNeeded();
  return element.evaluate(async (target) => {
    // Native scrolling clears the action. Create the test range after those
    // scroll notifications have run, as a pointer selection would do.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return selection.toString();
  });
}
async function addSelectionToChat(app: FrameLocator) {
  await selectionToolbar(app)
    .getByRole("button", { name: "Add to chat", exact: true })
    .click();
}
test.beforeEach(async ({ page }) => {
  observeDraftWrites(page);
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
  await page.goto("/?entry=project");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await choose(issueFrame(page), "GitHub view", "yu/Arco");
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

test(
  "fixture edits, comment, and label changes round trip through the real stdio MCP",
  { tag: "@smoke" },
  async ({ page }) => {
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
    await app
      .getByRole("region", { name: "Edit issue body", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      app.getByRole("heading", { name: "An edited issue", exact: true }),
    ).toBeVisible();
    await expect(app.locator(".issue-body")).toContainText(
      "Verify the Markdown update.",
    );
    await app
      .getByRole("textbox", { name: "Comment on GitHub" })
      .fill("A local fixture comment");
    await app.getByRole("button", { name: "Comment", exact: true }).click();
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
    await app
      .getByRole("region", { name: "Edit issue body", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(app.locator(".issue-body")).toContainText(
      "Body editing still works after comment and label changes.",
    );
  },
);

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
  await app
    .getByRole("region", { name: "Edit issue body", exact: true })
    .getByRole("button", { name: "Save", exact: true })
    .click();
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

test(
  "GitHub Markdown blocks active directives and forged selection provenance",
  { tag: "@smoke" },
  async ({ page }) => {
    await checkMarkdownSecurity(page, issueFrame(page), "arco_get_issue", {
      source: "github",
      repo: "yu/Arco",
      number: 42,
    });
  },
);

test(
  "body/comment range sharing carries exactly the selected source text",
  { tag: "@smoke" },
  async ({ page }) => {
    const app = issueFrame(page);
    let shares = 0;
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
      await selectText(app, selector);
      await addSelectionToChat(app);
      await expect.poll(() => events(page, "context")).toHaveLength(++shares);
      const context = latestSharedSelection(
        (await events(page, "context")).at(-1),
      );
      expect(context).toMatchObject({
        source: "github",
        repo: "yu/Arco",
        number: 42,
        selection: { text, origin },
      });
      expect(context).not.toHaveProperty("body");
      await expect(selectionToolbar(app)).toHaveCount(0);
    }
    expect(await events(page, "message")).toHaveLength(0);
  },
);

test("GitHub keeps a shared body range when adding a comment range after mouseup on comment padding", async ({
  page,
}) => {
  const app = issueFrame(page);
  await selectText(app, ".issue-body p");
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  expect(
    latestSharedSelection((await events(page, "context"))[0]),
  ).toMatchObject({
    selection: { origin: "body" },
  });

  await app.locator(".comment").first().scrollIntoViewIfNeeded();
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
  await expect(selectionToolbar(app)).toBeVisible();
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  const context = latestSharedSelection((await events(page, "context"))[1]);
  expect(context.selection).toEqual(selectedComment);
  expect(context).not.toHaveProperty("body");
  expect(
    (
      sharedContextFromText((await events(page, "context"))[1])
        .annotations as SharedAnnotation[]
    ).map((annotation) => annotation.selection.origin),
  ).toEqual(["body", "comment"]);
  expect(await events(page, "message")).toEqual([]);
  const tools = (await events(page, "tool")) as {
    arguments: Record<string, unknown>;
  }[];
  expect(tools.filter((tool) => "requestId" in tool.arguments)).toEqual([]);
});

test("GitHub removes the selection action after an empty selection and keeps whole-Issue sharing separate", async ({
  page,
}) => {
  const app = issueFrame(page);
  await selectText(app, ".issue-body p");
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  await selectText(app, ".issue-body p");
  await expect(selectionToolbar(app)).toBeVisible();
  await app.locator(".detail-scroll").evaluate((element) => {
    window.getSelection()!.removeAllRanges();
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(selectionToolbar(app)).toHaveCount(0);
  await app.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  const context = latestSharedSelection((await events(page, "context"))[1]);
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

test("GitHub shares a range crossing body and comment as UI text without guessing a comment identity", async ({
  page,
}) => {
  const app = issueFrame(page);
  const text = await app.locator(".detail-scroll").evaluate((element) => {
    const body = element.querySelector(".issue-body p")!.firstChild!;
    const comment = element.querySelector(
      '.comment [data-context-origin="comment"] p',
    )!.firstChild!;
    const range = document.createRange();
    range.setStart(body, 0);
    range.setEnd(comment, comment.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return selection.toString().trim();
  });
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const context = latestSharedSelection((await events(page, "context"))[0]);
  expect(context).toMatchObject({
    source: "github",
    repo: "yu/Arco",
    number: 42,
    selection: { text, origin: "ui" },
  });
  expect(context.selection).not.toHaveProperty("commentId");
  expect(context).not.toHaveProperty("body");
  expect(await events(page, "message")).toEqual([]);
});

test("GitHub shares title, property and list text while whole-Issue Add to chat stays explicit", async ({
  page,
}, testInfo) => {
  const app = issueFrame(page);
  let shares = 0;
  for (const [selector, number] of [
    [".issue-heading h1", 42],
    [".issue-properties .state-property h2", 42],
    ['.issue-row:has-text("Separate shared context") .row-title', 43],
  ] as const) {
    const text = await selectText(app, selector);
    if (selector === ".issue-heading h1") {
      await expect(selectionToolbar(app)).toBeVisible();
      const screenshot = testInfo.outputPath("selection-popup.png");
      await page.locator("#arco").screenshot({ path: screenshot });
      await testInfo.attach("GitHub text selection popup (fixture host)", {
        path: screenshot,
        contentType: "image/png",
      });
    }
    await addSelectionToChat(app);
    await expect.poll(() => events(page, "context")).toHaveLength(++shares);
    const context = latestSharedSelection(
      (await events(page, "context")).at(-1),
    );
    expect(context).toMatchObject({
      source: "github",
      repo: "yu/Arco",
      number,
      selection: { text, origin: "ui" },
    });
    expect(context).not.toHaveProperty("body");
  }
  await selectText(app, ".issue-heading h1");
  await app
    .locator(".detail-primary-actions")
    .getByRole("button", { name: "Add to chat", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(4);
  const context = latestSharedSelection((await events(page, "context"))[3]);
  expect(context).toMatchObject({ source: "github", number: 42 });
  expect(context).not.toHaveProperty("selection");
  expect(context.body).toContain(
    "Return to the same position when switching between issues.",
  );
  expect(await events(page, "message")).toEqual([]);
});

test("Arco title and text spanning different Issues share UI context without an arbitrary Issue identity", async ({
  page,
}) => {
  const app = issueFrame(page);
  const title = await selectText(app, ".sidebar-identity .wordmark");
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const titleContext = latestSharedSelection(
    (await events(page, "context"))[0],
  );
  expect(titleContext).toEqual({
    source: "arco",
    selection: { text: title, origin: "ui" },
  });

  const text = await app.locator(".issue-list").evaluate((list) => {
    const titles = list.querySelectorAll(".issue-row .row-title");
    const first = titles[0]!.firstChild!;
    const second = titles[1]!.firstChild!;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, second.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    list.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return selection.toString().trim();
  });
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  const mixedContext = latestSharedSelection(
    (await events(page, "context"))[1],
  );
  expect(mixedContext).toEqual({
    source: "arco",
    selection: { text, origin: "ui" },
  });
  expect(mixedContext).not.toHaveProperty("repo");
  expect(mixedContext).not.toHaveProperty("number");
  expect(mixedContext).not.toHaveProperty("body");
  expect(await events(page, "message")).toEqual([]);
});

test("keyboard selection in a GitHub comment draft supports Escape and adds only the selected text", async ({
  page,
}) => {
  const app = issueFrame(page);
  const comment = app.getByRole("textbox", { name: "Comment on GitHub" });
  const draft = "Keep this comment draft on this device";
  await comment.fill(draft);
  await comment.press("Home");
  await page.keyboard.down("Shift");
  for (let index = 0; index < 4; index += 1)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await expect(selectionToolbar(app)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(selectionToolbar(app)).toHaveCount(0);
  await expect(comment).toHaveValue(draft);
  expect(await events(page, "context")).toEqual([]);

  await comment.press("Home");
  await page.keyboard.down("Shift");
  for (let index = 0; index < 4; index += 1)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const context = latestSharedSelection((await events(page, "context"))[0]);
  expect(context).toMatchObject({
    source: "github",
    repo: "yu/Arco",
    number: 42,
    selection: { text: "Keep", origin: "ui" },
  });
  expect(context).not.toHaveProperty("body");
  await expect(comment).toHaveValue(draft);
  await expect(selectionToolbar(app)).toHaveCount(0);
  expect(await events(page, "message")).toEqual([]);
});

test("the selection action attaches the latest nonempty range rather than the range that opened it", async ({
  page,
}) => {
  const app = issueFrame(page);
  const first = await selectText(app, ".issue-body p");
  await expect(selectionToolbar(app)).toBeVisible();
  const latest = await app
    .locator(".issue-body p")
    .first()
    .evaluate((paragraph) => {
      const text = paragraph.firstChild!;
      const range = document.createRange();
      range.setStart(text, 7);
      range.setEnd(text, 19);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
  expect(latest.trim()).not.toBe("");
  expect(latest).not.toBe(first);
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const context = latestSharedSelection((await events(page, "context"))[0]);
  expect(context).toMatchObject({
    source: "github",
    number: 42,
    selection: { text: latest, origin: "body" },
  });
  expect(context).not.toHaveProperty("body");
  expect(await events(page, "message")).toEqual([]);
});

test("a retained GitHub selection edits an optional comment without changing the source text or sending a message", async ({
  page,
}) => {
  const app = issueFrame(page);
  const sourceText = await selectText(app, ".issue-body p");
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const dialog = selectionComment(app);
  const comment = dialog.getByRole("textbox", {
    name: "Optional comment",
    exact: true,
  });
  const marker = app.getByRole("button", {
    name: "Edit selection comment 1",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(comment).toHaveAttribute(
    "placeholder",
    "Add an optional comment…",
  );
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveText("1");
  await expect.poll(() => retainedSelection(app)).toEqual([sourceText]);
  expect(
    latestSharedSelection((await events(page, "context"))[0]),
  ).toMatchObject({ selection: { text: sourceText, origin: "body" } });

  const note = "Please explain this passage";
  await comment.fill(note);
  await comment.dispatchEvent("compositionstart", { data: "é" });
  await comment.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 229,
    isComposing: true,
  });
  await comment.dispatchEvent("compositionend", { data: "é" });
  await expect(comment).toHaveValue(note);
  await expect(dialog).toBeVisible();
  expect(await events(page, "context")).toHaveLength(1);
  expect(await events(page, "message")).toEqual([]);

  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  await expect(dialog).toHaveCount(0);
  const update = (await events(page, "context"))[1];
  expect(latestSharedSelection(update)).toMatchObject({
    source: "github",
    number: 42,
    selection: { text: sourceText, origin: "body", comment: note },
  });
  expect(
    (update as { content: { text: string }[] }).content[0]!.text,
  ).toContain(note);
  await expect.poll(() => retainedSelection(app)).toEqual([]);
  await expect(marker).toHaveCount(1);

  await marker.click();
  await expect(comment).toHaveValue(note);
  await comment.fill("  \n  ");
  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(3);
  const withoutComment = latestSharedSelection(
    (await events(page, "context"))[2],
  );
  expect(withoutComment.selection).toEqual({
    text: sourceText,
    origin: "body",
  });
  await expect(dialog).toHaveCount(0);

  await marker.click();
  await expect(comment).toHaveValue("");
  await comment.fill("Discard this unsaved note with Escape");
  await comment.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(marker).toHaveText("1");
  await expect.poll(() => retainedSelection(app)).toEqual([]);
  await marker.click();
  await expect(comment).toHaveValue("");
  await comment.fill("Discard this unsaved note by clicking outside");
  await app.getByRole("heading", { name: firstTitle, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await marker.click();
  await expect(comment).toHaveValue("");
  expect(await events(page, "context")).toHaveLength(3);
  expect(await events(page, "message")).toEqual([]);
  await expect(app.locator(".issue-body p").first()).toHaveText(sourceText);
});

test("two GitHub selections keep numbered markers and independent comments when the first annotation is edited", async ({
  page,
}) => {
  const app = issueFrame(page);
  const dialog = selectionComment(app);
  const comment = dialog.getByRole("textbox", { name: "Optional comment" });
  const save = dialog.getByRole("button", {
    name: "Save comment",
    exact: true,
  });
  const first = app.locator(
    '[data-arco-annotation="1"] .selection-annotation-number',
  );
  const second = app.locator(
    '[data-arco-annotation="2"] .selection-annotation-number',
  );
  const firstText = await selectText(app, ".issue-heading h1");
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  await comment.fill("First comment");
  await save.click();
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  const secondText = await selectText(app, ".issue-body p");
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(3);
  await expect(comment).toHaveValue("");
  await comment.fill("Second comment");
  await save.click();
  await expect.poll(() => events(page, "context")).toHaveLength(4);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(first).toHaveText("1");
  await expect(second).toHaveText("2");
  await expect.poll(() => retainedSelection(app)).toEqual([]);
  const collection = sharedContextFromText((await events(page, "context"))[3]);
  expect(collection).toEqual({
    source: "arco",
    arcoAnnotationSnapshotId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    annotations: [
      expect.objectContaining({
        number: 1,
        issue: expect.objectContaining({
          source: "github",
          repo: "yu/Arco",
          number: 42,
        }),
        selection: { text: firstText, origin: "ui", comment: "First comment" },
      }),
      expect.objectContaining({
        number: 2,
        issue: expect.objectContaining({
          source: "github",
          repo: "yu/Arco",
          number: 42,
        }),
        selection: {
          text: secondText,
          origin: "body",
          comment: "Second comment",
        },
      }),
    ],
  });
  const secondAnnotation = (collection.annotations as SharedAnnotation[])[1];
  await first.click();
  await expect.poll(() => retainedSelection(app)).toEqual([firstText]);
  await expect(comment).toHaveValue("First comment");
  await comment.fill("Updated first comment");
  await save.click();
  await expect.poll(() => events(page, "context")).toHaveLength(5);
  const edited = sharedContextFromText((await events(page, "context"))[4]);
  const annotations = edited.annotations as SharedAnnotation[];
  expect(annotations[0]).toMatchObject({
    number: 1,
    selection: {
      text: firstText,
      origin: "ui",
      comment: "Updated first comment",
    },
  });
  expect(annotations[1]).toEqual(secondAnnotation);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect.poll(() => retainedSelection(app)).toEqual([]);
  const sharedBeforeBrowsing = await events(page, "context");
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await expect(
    app.getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  await expect(first).toBeHidden();
  await expect(second).toBeHidden();
  expect(await events(page, "context")).toEqual(sharedBeforeBrowsing);
  await app.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect.poll(() => retainedSelection(app)).toEqual([]);
  expect(await events(page, "context")).toEqual(sharedBeforeBrowsing);
  await second.click();
  await expect(comment).toHaveValue("Second comment");
  await comment.press("Escape");
  expect(await events(page, "context")).toHaveLength(5);
  await first.click();
  await dialog
    .getByRole("button", { name: "Remove annotation 1", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(6);
  const remaining = sharedContextFromText((await events(page, "context"))[5]);
  expect(remaining.annotations).toEqual([secondAnnotation]);
  await expect(first).toHaveCount(0);
  await expect(second).toHaveText("1");
  await expect.poll(() => retainedSelection(app)).toEqual([]);
  await second.click();
  await expect(comment).toHaveValue("Second comment");
  await dialog
    .getByRole("button", { name: "Remove annotation 1", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(7);
  expect((await events(page, "context"))[6]).toEqual({
    content: [],
    structuredContent: { source: "arco", arcoAnnotationFormat: 2 },
  });
  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => retainedSelection(app)).toEqual([]);
  expect(await events(page, "message")).toEqual([]);
});

test(
  "removing the native annotation group also removes Arco markers and highlights",
  { tag: "@smoke" },
  async ({ page }) => {
    const app = issueFrame(page);
    await selectText(app, ".issue-heading h1");
    await addSelectionToChat(app);
    await expect(selectionComment(app)).toBeVisible();
    await selectText(app, ".issue-body p");
    await addSelectionToChat(app);
    await expect(
      app.getByRole("button", { name: /Edit selection comment/ }),
    ).toHaveCount(2);
    const updates = await events(page, "context");
    const shared = updates.at(-1) as {
      content: { _meta?: Record<string, unknown> }[];
      structuredContent: Record<string, unknown>;
    };
    const group = shared.content[0]._meta?.["openai/group"];
    const remaining = shared.content.filter(
      (item) =>
        JSON.stringify(item._meta?.["openai/group"]) !== JSON.stringify(group),
    );
    await updateHostContext(page, {
      "openai/modelContext": remaining.length
        ? { ...shared, content: remaining, updateId: "native-group-removed" }
        : null,
    });
    await expect(
      app.getByRole("button", { name: /Edit selection comment/ }),
    ).toHaveCount(0);
    await expect(selectionComment(app)).toHaveCount(0);
    await expect.poll(() => retainedSelection(app)).toEqual([]);
    expect(await events(page, "context")).toEqual(updates);
    expect(await events(page, "message")).toEqual([]);
  },
);

test("native item deletion renumbers remaining markers and never restores the removed quote", async ({
  page,
}) => {
  const app = issueFrame(page);
  const dialog = selectionComment(app);
  const comment = dialog.getByRole("textbox", { name: "Optional comment" });
  const quotes: string[] = [];
  for (const [index, selector] of [
    ".issue-heading h1",
    ".issue-body p",
    ".comment [data-context-origin='comment'] p",
  ].entries()) {
    quotes.push(await selectText(app, selector));
    await addSelectionToChat(app);
    await comment.fill(`Annotation note ${index + 1}`);
    await dialog
      .getByRole("button", { name: "Save comment", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  }
  await expect.poll(() => events(page, "context")).toHaveLength(6);
  type Attachment = {
    content: { _meta?: Record<string, unknown> }[];
    structuredContent: Record<string, unknown>;
  };
  const attached = (await events(page, "context")).at(-1) as Attachment;
  const remaining = {
    ...attached,
    content: attached.content.filter((_, index) => index !== 1),
  };
  await updateHostContext(page, {
    "openai/modelContext": { ...remaining, updateId: "native-middle-deleted" },
  });
  const first = app.locator(
    '[data-arco-annotation="1"] .selection-annotation-number',
  );
  const removed = app.locator(
    '[data-arco-annotation="2"] .selection-annotation-number',
  );
  const third = app.locator(
    '[data-arco-annotation="3"] .selection-annotation-number',
  );
  await expect(removed).toHaveCount(0);
  await expect(first).toHaveText("1");
  await expect(third).toHaveText("2");
  await third.scrollIntoViewIfNeeded();
  await third.click();
  await expect(comment).toHaveValue("Annotation note 3");
  await comment.fill("Revised surviving annotation");
  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(7);
  const revised = (await events(page, "context")).at(-1) as Attachment;
  expect(sharedContextFromText(revised).annotations).toMatchObject([
    { number: 1, selection: { text: quotes[0], comment: "Annotation note 1" } },
    {
      number: 3,
      selection: { text: quotes[2], comment: "Revised surviving annotation" },
    },
  ]);
  expect(JSON.stringify(revised)).not.toContain(quotes[1]);
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await page
    .getByRole("button", { name: "Mock fullscreen", exact: true })
    .click();
  await expect(removed).toHaveCount(0);
  await expect(third).toHaveText("2");
  await updateHostContext(page, {
    "openai/modelContext": {
      ...revised,
      content: [revised.content[1]],
      updateId: "native-first-deleted",
    },
  });
  await expect(first).toHaveCount(0);
  await expect(third).toHaveText("1");
  await updateHostContext(page, {
    "openai/modelContext": {
      ...revised,
      content: [],
      updateId: "native-last-deleted",
    },
  });
  await expect(app.locator(".selection-annotation-number")).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  expect(await events(page, "context")).toHaveLength(7);
  expect(await events(page, "message")).toEqual([]);
});

test("narrow input selections keep their source draft and survive presentation updates until native context removal or replacement", async ({
  page,
}) => {
  const app = issueFrame(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await app.locator(".issue-row").filter({ hasText: firstTitle }).click();
  const source = app.getByRole("textbox", { name: "Comment on GitHub" });
  const draft = "Keep this GitHub comment draft on this device";
  await source.fill(draft);
  await source.scrollIntoViewIfNeeded();
  await source.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(0, 4);
    element.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const dialog = selectionComment(app);
  const comment = dialog.getByRole("textbox", { name: "Optional comment" });
  const marker = app.getByRole("button", {
    name: "Edit selection comment 1",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const retainedInput = app.locator(".selection-retained-input");
  await expect(retainedInput.locator("mark")).toHaveText("Keep");
  const bounds = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
  await comment.fill("Explain the selected draft text without posting it");
  await expect(source).toHaveValue(draft);
  await updateHostContext(page, {
    theme: "light",
    containerDimensions: { width: 390, maxHeight: 729 },
  });
  await expect(dialog).toBeVisible();
  await expect(comment).toHaveValue(
    "Explain the selected draft text without posting it",
  );
  await expect(retainedInput.locator("mark")).toHaveText("Keep");
  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  expect(
    latestSharedSelection((await events(page, "context"))[1]),
  ).toMatchObject({
    source: "github",
    repo: "yu/Arco",
    number: 42,
    selection: {
      text: "Keep",
      origin: "ui",
      comment: "Explain the selected draft text without posting it",
    },
  });
  await expect(source).toHaveValue(draft);
  await expect(retainedInput).toHaveCount(0);
  await source.scrollIntoViewIfNeeded();
  await source.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(10, 16);
    element.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(3);
  await expect(comment).toHaveValue("");
  await comment.fill("Explain the second selected range independently");
  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(4);
  const secondMarker = app.getByRole("button", {
    name: "Edit selection comment 2",
    exact: true,
  });
  await expect(marker).toBeVisible();
  await expect(secondMarker).toBeVisible();
  const rectangles = await Promise.all(
    [marker, secondMarker].map((badge) =>
      badge.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      }),
    ),
  );
  const [firstRect, secondRect] = rectangles;
  expect(
    firstRect!.left < secondRect!.right &&
      firstRect!.right > secondRect!.left &&
      firstRect!.top < secondRect!.bottom &&
      firstRect!.bottom > secondRect!.top,
  ).toBe(false);
  await expect(retainedInput).toHaveCount(0);
  const twoInputSelections = sharedContextFromText(
    (await events(page, "context"))[3],
  ).annotations as SharedAnnotation[];
  expect(twoInputSelections).toHaveLength(2);
  expect(twoInputSelections[0]).toMatchObject({
    number: 1,
    selection: {
      text: "Keep",
      origin: "ui",
      comment: "Explain the selected draft text without posting it",
    },
  });
  expect(twoInputSelections[1]).toMatchObject({
    number: 2,
    selection: {
      text: "GitHub",
      origin: "ui",
      comment: "Explain the second selected range independently",
    },
  });
  await marker.click();
  await expect(comment).toHaveValue(
    "Explain the selected draft text without posting it",
  );
  await comment.fill("Revised note for the first selected input range");
  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect.poll(() => events(page, "context")).toHaveLength(5);
  const editedInputSelections = sharedContextFromText(
    (await events(page, "context"))[4],
  ).annotations as SharedAnnotation[];
  expect(editedInputSelections[0]).toMatchObject({
    number: 1,
    selection: {
      text: "Keep",
      origin: "ui",
      comment: "Revised note for the first selected input range",
    },
  });
  expect(editedInputSelections[1]).toEqual(twoInputSelections[1]);
  await secondMarker.click();
  await expect(comment).toHaveValue(
    "Explain the second selected range independently",
  );
  await expect(source).toHaveValue(draft);
  await expect(dialog).toBeVisible();
  await updateHostContext(page, { "openai/modelContext": null });
  await expect(dialog).toHaveCount(0);
  await expect(marker).toHaveCount(0);
  await expect(secondMarker).toHaveCount(0);
  await expect(retainedInput).toHaveCount(0);
  await expect.poll(() => retainedSelection(app)).toEqual([]);

  const bodyText = await selectText(app, ".issue-body p");
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(6);
  await expect.poll(() => retainedSelection(app)).toEqual([bodyText]);
  await expect(dialog).toBeVisible();
  await updateHostContext(page, {
    "openai/modelContext": {
      updateId: "fixture-native-replacement",
      content: [{ type: "text", text: "A different native attachment" }],
      structuredContent: { source: "arco" },
    },
  });
  await expect(dialog).toHaveCount(0);
  await expect(marker).toHaveCount(0);
  await expect.poll(() => retainedSelection(app)).toEqual([]);
  await expect(source).toHaveValue(draft);
  expect(await events(page, "context")).toHaveLength(6);
  expect(await events(page, "message")).toEqual([]);
});

test("a range from an Issue row to its matching detail stays generic when it crosses another Issue", async ({
  page,
}) => {
  const app = issueFrame(page);
  const text = await app.locator(".workspace").evaluate((workspace) => {
    const start = workspace.querySelector(".issue-row .row-title")!.firstChild!;
    const end = workspace.querySelector(".issue-heading h1")!.firstChild!;
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    workspace.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return selection.toString();
  });
  expect(text).toContain(firstTitle);
  expect(text).toContain(secondTitle);
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const context = latestSharedSelection((await events(page, "context"))[0]);
  expect(context).toEqual({
    source: "arco",
    selection: { text, origin: "ui" },
  });
  expect(await events(page, "message")).toEqual([]);
});

test("dragging list text in a narrow panel keeps the current Issue and the popup inside the iframe", async ({
  page,
}) => {
  const app = issueFrame(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const row = app.locator(".issue-row").filter({ hasText: secondTitle });
  const title = row.locator(".row-title");
  await title.scrollIntoViewIfNeeded();
  const characters = await title.evaluate((element) => {
    const text = element.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const first = range.getBoundingClientRect();
    range.setStart(text, 14);
    range.setEnd(text, 15);
    const last = range.getBoundingClientRect();
    return {
      start: first.left + 1,
      end: last.right - 1,
      y: first.top + first.height / 2,
      userSelect: getComputedStyle(element).userSelect,
    };
  });
  const iframe = (await page.locator("#arco").boundingBox())!;
  const y = iframe.y + characters.y;
  await page.mouse.move(iframe.x + characters.start, y);
  await page.mouse.down();
  await page.mouse.move(iframe.x + characters.end, y, {
    steps: 12,
  });
  await page.mouse.up();
  const text = await row.evaluate(() => window.getSelection()!.toString());
  expect(
    text.trim(),
    `row title user-select: ${characters.userSelect}`,
  ).not.toBe("");
  expect(secondTitle).toContain(text);
  await expect(app.locator(".issue-row.selected")).toContainText(firstTitle);
  await expect(row).not.toHaveClass(/selected/);
  await expect(selectionToolbar(app)).toBeVisible();
  const popup = await selectionToolbar(app).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });
  expect(popup.left).toBeGreaterThanOrEqual(0);
  expect(popup.top).toBeGreaterThanOrEqual(0);
  expect(popup.right).toBeLessThanOrEqual(popup.width);
  expect(popup.bottom).toBeLessThanOrEqual(popup.height);
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const context = latestSharedSelection((await events(page, "context"))[0]);
  expect(context).toMatchObject({
    source: "github",
    number: 43,
    selection: { text, origin: "ui" },
  });
  expect(await events(page, "message")).toEqual([]);
});

test("a selected comment draft can reach Add to chat by Tab and attach by Enter", async ({
  page,
}) => {
  const app = issueFrame(page);
  const comment = app.getByRole("textbox", { name: "Comment on GitHub" });
  const draft = "Keep this keyboard-only comment draft";
  await comment.fill(draft);
  await comment.press("Home");
  await page.keyboard.down("Shift");
  for (let index = 0; index < 4; index += 1)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  const add = selectionToolbar(app).getByRole("button", {
    name: "Add to chat",
    exact: true,
  });
  await expect(add).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const context = latestSharedSelection((await events(page, "context"))[0]);
  expect(context).toMatchObject({
    source: "github",
    number: 42,
    selection: { text: "Keep", origin: "ui" },
  });
  await expect(comment).toHaveValue(draft);
  expect(await events(page, "message")).toEqual([]);
});

test(
  "issue drafts and search survive selection changes; browse never shares",
  { tag: "@smoke" },
  async ({ page }) => {
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
    // Wait for the debounced result before selecting, so this exercises
    // restoration from a filtered list rather than clicking the previous list.
    await expect(app.locator(".issue-row")).toHaveCount(1);
    await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
    await expect(
      app.getByRole("heading", { name: secondTitle, exact: true }),
    ).toBeVisible();
    await expect(
      app.getByRole("textbox", { name: "Search issues" }),
    ).toHaveValue("shared");
    await app.getByRole("textbox", { name: "Search issues" }).fill("");
    await expect(app.locator(".issue-row")).toHaveCount(3);
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
  },
);

test("whole-Issue sharing and mock mentions retain explicit context without sending messages", async ({
  page,
}) => {
  const app = issueFrame(page);
  await app.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const sharedContext = latestSharedSelection(
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
  await expect(app.locator(".shared-chip")).toHaveText("In chat");
  await expect(app.locator(".shared-chip")).toHaveAttribute(
    "aria-label",
    "Shared issue: yu/Arco #42",
  );
  await app.locator(".issue-row").filter({ hasText: secondTitle }).click();
  await expect(app.locator(".shared-chip")).toContainText("yu/Arco #42");
  await expect(app.locator(".shared-chip")).toHaveAttribute(
    "aria-label",
    "Shared issue: yu/Arco #42 · Different from the issue you are browsing",
  );
  await expect(app.locator(".toolbar-target")).toHaveText("yu/Arco #43");
  expect(await events(page, "message")).toEqual([]);
  expect(await events(page, "context")).toEqual(explicitContext);
  await expect(app.locator(".shared-chip")).toContainText("yu/Arco #42");
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
    "Could not open issue details. Try again.",
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
  await expectDraftWrite(page, { comment: draft });
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

test("GitHub comments append bounded pages, retain a posted comment through refresh, and reconcile edits and deletion", async ({
  page,
}) => {
  const app = issueFrame(page);
  await page.clock.install();
  let issue: IssueDetail | undefined;
  let comments: Comment[] = Array.from({ length: 100 }, (_, index) => ({
    id: `paged-comment-${index + 1}`,
    databaseId: index + 1,
    body: `Paged comment ${index + 1}`,
    author: "fixture-user",
    url: `https://github.com/yu/Arco/issues/42#issuecomment-${index + 1}`,
    updatedAt: "2026-10-22T01:00:00Z",
  }));
  const pages: number[] = [];
  let releasePage!: () => void;
  const pendingPage = new Promise<void>((resolve) => {
    releasePage = resolve;
  });
  const detail = (): IssueDetail => ({
    ...issue!,
    comments: comments.slice(0, 30),
    commentsHasMore: comments.length > 30,
    commentsNextPage: comments.length > 30 ? 2 : undefined,
  });
  const result = (value: object) => ({
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value) }],
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: {
        number?: number;
        page?: number;
        body?: string;
        commentId?: number;
      };
    };
    if (input.name === "arco_get_issue" && input.arguments.number === 42) {
      if (!issue) {
        const response = await route.fetch();
        issue = (await response.json()).structuredContent as IssueDetail;
      }
      return route.fulfill({ json: result(detail()) });
    }
    if (input.name === "arco_comments") {
      const page = input.arguments.page!;
      pages.push(page);
      if (page === 2) await pendingPage;
      const hasMore = comments.length > page * 30;
      return route.fulfill({
        json: result({
          comments: comments.slice((page - 1) * 30, page * 30),
          hasMore,
          nextPage: hasMore ? page + 1 : undefined,
        }),
      });
    }
    if (input.name === "arco_comment") {
      const id = comments.length + 1;
      const postedComment: Comment = {
        ...comments[0],
        id: `paged-comment-${id}`,
        databaseId: id,
        body: input.arguments.body!,
        url: `https://github.com/yu/Arco/issues/42#issuecomment-${id}`,
        updatedAt: "2026-10-24T01:00:00Z",
      };
      comments.push(postedComment);
      return route.fulfill({ json: result({ ...detail(), postedComment }) });
    }
    if (input.name === "arco_edit_comment") {
      const changedComment = comments.find(
        (comment) => comment.databaseId === input.arguments.commentId,
      )!;
      changedComment.body = input.arguments.body!;
      changedComment.updatedAt = "2026-10-24T01:01:00Z";
      return route.fulfill({
        json: result({
          repo: "yu/Arco",
          number: 42,
          issue: detail(),
          changedComment,
        }),
      });
    }
    if (input.name === "arco_delete_comment") {
      comments = comments.filter(
        (comment) => comment.databaseId !== input.arguments.commentId,
      );
      return route.fulfill({
        json: result({
          repo: "yu/Arco",
          number: 42,
          issue: detail(),
          deleted: true,
        }),
      });
    }
    if (input.name === "arco_reactions")
      return route.fulfill({
        json: result({
          repo: "yu/Arco",
          number: 42,
          account: "fixture-user",
          reactions: [],
        }),
      });
    return route.continue();
  });
  await app.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(app.locator("article.comment")).toHaveCount(30);
  expect(pages).toEqual([]);
  await app
    .getByRole("button", { name: "Load more comments", exact: true })
    .click();
  await expect.poll(() => pages.length).toBe(1);
  comments[0].body = "Fresh first comment while page two is pending";
  await page.clock.fastForward(30_100);
  await expect(app.getByText(comments[0].body, { exact: true })).toHaveCount(1);
  releasePage();
  await expect(app.locator("article.comment")).toHaveCount(60);
  await expect(app.getByText(comments[0].body, { exact: true })).toHaveCount(1);
  expect(pages).toEqual([2]);
  await app
    .getByRole("textbox", { name: "Comment on GitHub" })
    .fill("Posted beyond the loaded comment window");
  await app.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(
    app
      .locator("article.comment")
      .getByText("Posted beyond the loaded comment window", { exact: true }),
  ).toBeVisible();
  await expect(app.locator("article.comment")).toHaveCount(61);
  await app
    .getByRole("textbox", { name: "Comment on GitHub" })
    .fill("Second posted comment beyond the window");
  await app.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(app.locator("article.comment")).toHaveCount(62);
  await app.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(app.locator("article.comment")).toHaveCount(62);
  await expect(app.getByText("Paged comment 60", { exact: true })).toHaveCount(
    1,
  );
  const posted = app
    .locator("article.comment")
    .filter({ hasText: "Posted beyond the loaded comment window" });
  await posted.getByRole("button", { name: "Edit", exact: true }).click();
  await posted
    .getByRole("textbox", { name: "Edit comment", exact: true })
    .fill("Edited posted comment beyond the window");
  await posted
    .getByRole("button", { name: "Update comment", exact: true })
    .click();
  await expect(
    app.getByText("Edited posted comment beyond the window", { exact: true }),
  ).toBeVisible();
  await expect(app.locator("article.comment").nth(60)).toContainText(
    "Edited posted comment beyond the window",
  );
  await expect(app.locator("article.comment").nth(61)).toContainText(
    "Second posted comment beyond the window",
  );
  await app
    .getByRole("button", { name: "Load more comments", exact: true })
    .click();
  await expect(app.locator("article.comment")).toHaveCount(92);
  await app
    .getByRole("button", { name: "Load more comments", exact: true })
    .click();
  await expect(app.locator("article.comment")).toHaveCount(102);
  await expect(
    app.getByText("Edited posted comment beyond the window", { exact: true }),
  ).toHaveCount(1);
  await expect(
    app.getByRole("button", { name: "Load more comments", exact: true }),
  ).toHaveCount(0);
  const edited = app
    .locator("article.comment")
    .filter({ hasText: "Edited posted comment beyond the window" });
  await edited.getByRole("button", { name: "Delete", exact: true }).click();
  await edited
    .getByRole("button", { name: "Delete this comment", exact: true })
    .click();
  await expect(app.locator("article.comment")).toHaveCount(101);
  await expect(
    app.getByText("Edited posted comment beyond the window", { exact: true }),
  ).toHaveCount(0);
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
      json: toolFailure("MCP error -32001: App server request queue is full"),
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

test("narrow panel remains usable; capture wide/narrow mock views", async ({
  page,
}, testInfo) => {
  const app = issueFrame(page);
  await page.screenshot({
    path: testInfo.outputPath("arco-wide.png"),
    fullPage: true,
  });
  await app.locator(".issue-row").filter({ hasText: firstTitle }).click();
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
  const writes: number[] = [];
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
    if (body.name === "arco_update_issue" && body.arguments?.number)
      writes.push(body.arguments.number);
    if (
      body.name === "arco_update_issue" &&
      body.arguments?.number === 43 &&
      writes.filter((number) => number === 43).length === 1
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          toolFailure("Fixture permission denied for #43", "forbidden"),
        ),
      });
    } else await route.continue();
  });
  await app.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    app.locator('.bulk-results[aria-label="Failed issues"] li'),
  ).toHaveCount(1);
  await expect(app.locator(".bulk-results")).not.toContainText("yu/Arco #42");
  await expect(app.locator(".bulk-results")).toContainText(
    "Fixture permission denied for #43",
  );
  const bulk = app.getByRole("region", { name: "Bulk issue actions" });
  await expect(bulk).toBeVisible();
  await app.getByRole("button", { name: "Closed", exact: true }).click();
  await expect(
    app.locator(".issue-row").filter({ hasText: firstTitle }),
  ).toBeVisible();
  await app.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    app.locator(".issue-row").filter({ hasText: secondTitle }),
  ).toBeVisible();
  await bulk
    .getByRole("button", { name: "Retry failed issues only", exact: true })
    .click();
  await expect(bulk).toHaveCount(0);
  expect(writes).toEqual([42, 43, 43]);
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
  await app.getByRole("button", { name: "Comment", exact: true }).click();
  const comment = app
    .locator(".comment")
    .filter({ hasText: "A fixture comment to edit" });
  await comment.getByRole("button", { name: "Edit", exact: true }).click();
  await comment
    .getByRole("textbox", { name: "Edit comment", exact: true })
    .fill("An edited fixture comment");
  await expect(
    comment.getByRole("button", { name: "Update comment", exact: true }),
  ).toHaveAttribute("data-color", "primary");
  await expect(
    comment.getByRole("button", { name: "Update comment", exact: true }),
  ).toHaveAttribute("data-variant", "solid");
  await comment
    .getByRole("button", { name: "Update comment", exact: true })
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
  await expect(
    selectControl(bulk, "Bulk action").getByRole("button"),
  ).toBeFocused();
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
  await bulk.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(bulk).toHaveCount(0);
  expect(await events(page, "tool")).toContainEqual(
    expect.objectContaining({
      name: "arco_change_labels",
      arguments: expect.objectContaining({ add: [labelName], remove: [] }),
    }),
  );
  await expect(
    app.getByRole("group", { name: "Labels", exact: true }),
  ).toContainText(labelName);
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
  await expectDraftWrite(page, { title: "Fixture created from a template" });
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
  await expectDraftWrite(page, {
    body: "A locally saved unsent body",
    comment: "A locally saved comment draft",
  });
  await app.getByRole("button", { name: "Create issue", exact: true }).click();
  const dialog = app.getByRole("dialog", { name: "Create issue" });
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("An uncreated issue draft");
  await dialog
    .getByRole("textbox", { name: "Body", exact: true })
    .fill("A body not yet created on the source");
  await expectDraftWrite(page, {
    title: "An uncreated issue draft",
    body: "A body not yet created on the source",
  });
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

test(
  "external content changes preserve the local draft and require an explicit conflict resolution",
  { tag: "@smoke" },
  async ({ page }) => {
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
      app
        .getByRole("region", { name: "Edit issue body", exact: true })
        .getByRole("button", { name: "Save", exact: true }),
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
    await app
      .getByRole("region", { name: "Edit issue body", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .click();
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
  },
);

test("compact GitHub resolves the account feed when no repository is selected", async ({
  page,
}) => {
  const app = issueFrame(page);
  let accountRead = false;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "arco_account_issues") accountRead = true;
    if (input.name !== "arco_get_settings") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const result = await response.json();
    result.structuredContent.settings.activeGithubRepo = null;
    await route.fulfill({ response, json: result });
  });
  await page.goto("/");
  await expect(selectControl(app, "GitHub view")).toHaveAttribute(
    "data-value",
    "account:assigned",
  );
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(
    app.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(app.getByText("Loading issue…", { exact: true })).toHaveCount(0);
  expect(accountRead).toBe(true);
  await app.getByRole("button", { name: "Open details", exact: true }).click();
  await expect(app.locator(".workspace")).toBeVisible();
  await expect(selectControl(app, "GitHub view")).toHaveAttribute(
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
      json: toolFailure("Fixture GitHub connection check failed"),
    });
  });
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  try {
    const loading = app.locator('[data-loading-skeleton="inline"]');
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute("aria-busy", "true");
    await expect(loading).toHaveText("Loading Arco");
    await expect(
      app.getByRole("button", { name: "Choose repository", exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
  await expect(app.getByRole("alert")).toContainText(
    "Fixture GitHub connection check failed",
  );
  await expect(app.locator("[data-loading-skeleton]")).toHaveCount(0);
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
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  await app.locator(".issue-row").filter({ hasText: firstTitle }).click();
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(app.locator(".inline-mode")).toBeVisible();
  await frame.goto(frame.url());
  await expect(
    app.getByRole("heading", { name: secondTitle, exact: true }),
  ).toBeVisible();
  await expect(app.locator(".inline-mode .compact-bottom")).toHaveCount(0);
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
  await expect(app.locator(".toolbar-target")).toHaveText("yu/Arco #42");
  await expect(app.locator(".toolbar-target")).toBeInViewport();
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

test("annotation restoration reconnects both Issue ranges and comments after iframe recreation without sharing again", async ({
  page,
}) => {
  const app = issueFrame(page);
  const comment = selectionComment(app).getByRole("textbox", {
    name: "Optional comment",
  });
  const save = selectionComment(app).getByRole("button", {
    name: "Save comment",
    exact: true,
  });
  const title = await selectText(app, ".issue-heading h1");
  await addSelectionToChat(app);
  await comment.fill("Keep the first annotation comment");
  await save.click();
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  const body = await selectText(app, ".issue-body p");
  await addSelectionToChat(app);
  await comment.fill("Keep the second annotation comment");
  await save.click();
  await expect.poll(() => events(page, "context")).toHaveLength(4);
  const contextBeforeReload = await events(page, "context");
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await page
    .getByRole("button", { name: "Mock fullscreen", exact: true })
    .click();
  await expect(app.locator(".workspace")).toBeVisible();
  await expect.poll(() => retainedSelection(app)).toEqual([]);
  for (const [number, note] of [
    [1, "Keep the first annotation comment"],
    [2, "Keep the second annotation comment"],
  ] as const) {
    const marker = app.getByRole("button", {
      name: `Edit selection comment ${number}`,
      exact: true,
    });
    await expect(marker).toHaveText(String(number));
    await marker.click();
    await expect
      .poll(() => retainedSelection(app))
      .toEqual([number === 1 ? title : body]);
    await expect(comment).toHaveValue(note);
    await comment.press("Escape");
  }
  expect(await events(page, "context")).toEqual(contextBeforeReload);
  const thirdText = await selectText(
    app,
    ".comment [data-context-origin='comment'] p",
  );
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(5);
  await expect(
    app.getByRole("button", {
      name: "Edit selection comment 3",
      exact: true,
    }),
  ).toHaveText("3");
  const restored = sharedContextFromText((await events(page, "context")).at(-1))
    .annotations as SharedAnnotation[];
  expect(restored).toMatchObject([
    {
      number: 1,
      issue: { source: "github", repo: "yu/Arco", number: 42 },
      selection: { text: title, comment: "Keep the first annotation comment" },
    },
    {
      number: 2,
      issue: { source: "github", repo: "yu/Arco", number: 42 },
      selection: { text: body, comment: "Keep the second annotation comment" },
    },
    { number: 3, selection: { text: thirdText, origin: "comment" } },
  ]);
  expect(await events(page, "message")).toEqual([]);
});

test("annotation restoration hashes unselected input text and refuses a changed draft", async ({
  page,
}) => {
  const app = issueFrame(page);
  const source = app.getByRole("textbox", { name: "Comment on GitHub" });
  const prefix = "PRIVATE_UNSELECTED_PREFIX_";
  const text = "restore this selected slice";
  const suffix = "_PRIVATE_UNSELECTED_SUFFIX";
  const draft = prefix + text + suffix;
  await source.fill(draft);
  await expectDraftWrite(page, { comment: draft });
  await source.scrollIntoViewIfNeeded();
  await source.evaluate(
    (element: HTMLTextAreaElement, { start, end }) => {
      element.focus();
      element.setSelectionRange(start, end);
      element.dispatchEvent(new Event("select", { bubbles: true }));
    },
    { start: prefix.length, end: prefix.length + text.length },
  );
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  await selectionComment(app).press("Escape");
  const writes = (
    (await events(page, "tool")) as {
      name: string;
      arguments: { anchors?: { anchor: unknown }[] };
    }[]
  ).filter((call) => call.name === "arco_write_annotation_snapshot");
  expect(writes).toHaveLength(1);
  expect(writes[0]!.arguments.anchors).toEqual([
    expect.objectContaining({
      anchor: expect.objectContaining({
        rootKind: ".detail-pane",
        selectionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        target: expect.objectContaining({
          kind: "editable",
          start: prefix.length,
          end: prefix.length + text.length,
          valueHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    }),
  ]);
  const savedPositions = JSON.stringify(writes);
  const shared = JSON.stringify(await events(page, "context"));
  for (const privateText of [prefix, suffix, draft]) {
    expect(savedPositions).not.toContain(privateText);
    expect(shared).not.toContain(privateText);
  }
  expect(savedPositions).not.toContain(text);
  expect(shared).toContain(text);
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await page
    .getByRole("button", { name: "Mock fullscreen", exact: true })
    .click();
  await expect(app.locator(".workspace")).toBeVisible();
  await expect(source).toHaveValue(draft);
  await source.scrollIntoViewIfNeeded();
  const mark = app.locator(".selection-retained-input mark");
  await expect(mark).toHaveCount(0);
  const marker = app.getByRole("button", {
    name: "Edit selection comment 1",
    exact: true,
  });
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(mark).toHaveText(text);
  await selectionComment(app).press("Escape");
  const changedDraft = `Changed ${draft}`;
  await source.fill(changedDraft);
  await expect(marker).toHaveCount(0);
  await expect(mark).toHaveCount(0);
  await expectDraftWrite(page, { comment: changedDraft });
  const read = page.waitForResponse((response) => {
    if (!response.url().endsWith("/tool")) return false;
    return (
      (response.request().postDataJSON() as { name: string }).name ===
      "arco_read_annotation_snapshot"
    );
  });
  await frame.goto(frame.url());
  await (await read).finished();
  await page
    .getByRole("button", { name: "Mock fullscreen", exact: true })
    .click();
  await expect(app.locator(".workspace")).toBeVisible();
  await expect(source).toHaveValue(changedDraft);
  await source.scrollIntoViewIfNeeded();
  await source.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(marker).toHaveCount(0);
  await expect(mark).toHaveCount(0);
  await source.fill(draft);
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(mark).toHaveText(text);
  expect(await events(page, "context")).toHaveLength(1);
  expect(await events(page, "message")).toEqual([]);
});

test("annotation restoration reconnects generic UI and cross-Issue ranges in the same workspace", async ({
  page,
}) => {
  const app = issueFrame(page);
  const title = await selectText(app, ".sidebar-identity .wordmark");
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  await selectionComment(app).press("Escape");
  const { text, sourceText } = await app
    .locator(".issue-list")
    .evaluate((list) => {
      const titles = list.querySelectorAll(".issue-row .row-title");
      const first = titles[0]!.firstChild!;
      const second = titles[1]!.firstChild!;
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(second, second.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      list.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return { text: selection.toString(), sourceText: range.toString() };
    });
  expect(text).toContain(firstTitle);
  expect(text).toContain(secondTitle);
  await addSelectionToChat(app);
  await expect.poll(() => events(page, "context")).toHaveLength(2);
  await selectionComment(app).press("Escape");
  const sharedBeforeReload = await events(page, "context");
  const shared = sharedContextFromText(sharedBeforeReload.at(-1));
  expect(shared).toMatchObject({
    source: "arco",
    annotations: [
      { number: 1, selection: { text: title, origin: "ui" } },
      { number: 2, selection: { text, origin: "ui" } },
    ],
  });
  for (const item of shared.annotations as SharedAnnotation[])
    expect(item).not.toHaveProperty("issue");
  const frame = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/arco.html"))!;
  await frame.goto(frame.url());
  await page
    .getByRole("button", { name: "Mock fullscreen", exact: true })
    .click();
  await expect(app.locator(".workspace")).toBeVisible();
  await expect.poll(() => retainedSelection(app)).toEqual([]);
  for (const number of [1, 2]) {
    const marker = app.getByRole("button", {
      name: `Edit selection comment ${number}`,
      exact: true,
    });
    await expect(marker).toHaveText(String(number));
    await marker.click();
    await expect
      .poll(() => retainedSelection(app))
      .toEqual([number === 1 ? title : sourceText]);
    await selectionComment(app).press("Escape");
  }
  expect(await events(page, "context")).toEqual(sharedBeforeReload);
  expect(await events(page, "message")).toEqual([]);
});

for (const change of ["replacement", "removal"] as const) {
  test(`annotation restoration ignores a delayed snapshot after native ${change}`, async ({
    page,
  }) => {
    const app = issueFrame(page);
    await selectText(app, ".issue-heading h1");
    await addSelectionToChat(app);
    await expect.poll(() => events(page, "context")).toHaveLength(1);
    await selectionComment(app).press("Escape");
    const shared = (await events(page, "context"))[0] as {
      content: unknown[];
      structuredContent: Record<string, unknown>;
    };
    const id = shared.structuredContent.arcoAnnotationSnapshotId;
    expect(id).toEqual(expect.any(String));
    let releaseRead: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let readStarted = false;
    let finishRead: () => void = () => {};
    const delivered = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    await page.route("**/tool", async (route) => {
      const request = route.request().postDataJSON() as {
        name: string;
        arguments: { id?: string };
      };
      if (
        request.name !== "arco_read_annotation_snapshot" ||
        request.arguments.id !== id
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      readStarted = true;
      await blocked;
      await route.fulfill({ response });
      finishRead();
    });
    const frame = page
      .frames()
      .find((candidate) => candidate.url().endsWith("/arco.html"))!;
    await frame.goto(frame.url());
    try {
      await expect.poll(() => readStarted).toBe(true);
      await expect(
        app.getByRole("heading", { name: firstTitle, exact: true }),
      ).toBeVisible();
      await updateHostContext(page, {
        "openai/modelContext":
          change === "removal"
            ? null
            : {
                ...shared,
                updateId: "fixture-replaced-annotation-snapshot",
                structuredContent: {
                  ...shared.structuredContent,
                  arcoAnnotationSnapshotId:
                    "2af82498-3814-4a1e-a1db-7acbcb91f386",
                },
              },
      });
      if (change === "replacement")
        await expect
          .poll(async () =>
            (await events(page, "tool")).some(
              (value) =>
                (value as { name: string; arguments: { id?: string } }).name ===
                  "arco_read_annotation_snapshot" &&
                (value as { arguments: { id?: string } }).arguments.id !== id,
            ),
          )
          .toBe(true);
      else await expect(app.locator(".shared-chip")).toHaveCount(0);
    } finally {
      releaseRead();
    }
    await delivered;
    await app
      .locator("body")
      .evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    await expect(app.locator(".selection-annotation-number")).toHaveCount(0);
    await expect.poll(() => retainedSelection(app)).toEqual([]);
    expect(await events(page, "context")).toHaveLength(1);
    expect(await events(page, "message")).toEqual([]);
  });
}
