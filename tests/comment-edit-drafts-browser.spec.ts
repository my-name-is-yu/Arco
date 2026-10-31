import { expect, test, type Page } from "./browser-test";
import type { Comment, IssueDetail } from "../src/shared/contracts";
import type { LinearComment, LinearIssue } from "../src/shared/linear";
import type { Draft, DraftKey, DraftRecord } from "../src/shared/state";
import { toolFailure } from "./tool-failure";

type Source = "github" | "linear";
type ToolInput = {
  session: string;
  name: string;
  arguments: {
    key?: DraftKey;
    draft?: Draft;
    expectedRevision?: number;
    action?: string;
    body?: string;
    expectedUpdatedAt?: string;
  };
};
function storage() {
  return {
    session: "",
    record: { revision: 0, draft: null } as DraftRecord,
    readFails: false,
    providerFails: false,
    blockedRead: undefined as Promise<void> | undefined,
    writes: [] as ToolInput[],
    providerWrites: [] as ToolInput[],
  };
}
async function intercept(
  page: Page,
  source: Source,
  state: ReturnType<typeof storage>,
) {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolInput;
    state.session = input.session;
    if (
      ["arco_edit_comment", "arco_delete_comment"].includes(input.name) ||
      (input.name === "linear_comment" && input.arguments.action !== "create")
    ) {
      state.providerWrites.push(input);
      if (state.providerFails)
        return route.fulfill({
          json: toolFailure("Comment change unavailable."),
        });
    }
    if (
      input.arguments.key?.source !== source ||
      !input.arguments.key.issue.includes(":comment:")
    )
      return route.continue();
    if (input.name === "arco_read_draft") {
      const record = structuredClone(state.record);
      await state.blockedRead;
      return route.fulfill({
        json: state.readFails
          ? toolFailure("Comment draft read unavailable.", "storage")
          : { structuredContent: record },
      });
    }
    state.writes.push(input);
    if (input.arguments.expectedRevision !== state.record.revision)
      return route.fulfill({
        json: toolFailure("Another view changed this draft.", "conflict"),
      });
    state.record = {
      revision: state.record.revision + 1,
      draft: input.name === "arco_delete_draft" ? null : input.arguments.draft!,
    };
    return route.fulfill({ json: { structuredContent: state.record } });
  });
}
const target = (source: Source) =>
  source === "github"
    ? { repo: "yu/Arco", number: 42 }
    : {
        connectionId: "default",
        workspaceId: "fixture-linear-workspace",
        teamId: "fixture-linear-team",
        issueId: "fixture-linear-42",
      };
async function fixtureCall<T>(
  page: Page,
  state: ReturnType<typeof storage>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await page.request.post(new URL("/tool", page.url()).href, {
    data: { session: state.session, name, arguments: args },
  });
  const result = await response.json();
  expect(result.isError).not.toBe(true);
  return result.structuredContent as T;
}
async function commentEditor(
  page: Page,
  source: Source,
  state: ReturnType<typeof storage>,
) {
  await page.goto(
    source === "github"
      ? "/?entry=detail&issueRepo=yu/Arco&number=42"
      : "/?entry=detail&source=linear&number=42",
  );
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  const ui = page.frameLocator("#arco");
  if (source === "linear") {
    await ui
      .getByRole("textbox", { name: "Linear comment", exact: true })
      .fill("Editable fixture comment");
    await ui.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(
      ui
        .locator(".linear-comment")
        .filter({ hasText: "Editable fixture comment" }),
    ).toBeVisible();
  }
  const read = () =>
    fixtureCall<IssueDetail | LinearIssue>(
      page,
      state,
      source === "github" ? "arco_get_issue" : "linear_get_issue",
      target(source),
    );
  const issue = await read();
  const original =
    source === "github"
      ? issue.comments[0]
      : issue.comments.find(
          (comment) => comment.body === "Editable fixture comment",
        )!;
  const container =
    source === "github"
      ? ui.locator(".comment").first()
      : ui.locator(".linear-comment").last();
  const editor = container.getByRole("textbox", {
    name: source === "github" ? "Edit comment" : "Edit Linear comment",
    exact: true,
  });
  return {
    ui,
    container,
    editor,
    original,
    read,
    open: () =>
      container.getByRole("button", { name: "Edit", exact: true }).click(),
    save: () =>
      container
        .getByRole("button", {
          name: source === "github" ? "Update comment" : "Save",
          exact: true,
        })
        .click(),
    refresh: () =>
      ui
        .getByRole("button", {
          name: source === "github" ? "Refresh" : "Refresh Linear",
          exact: true,
        })
        .click(),
    update: (body: string) =>
      fixtureCall(
        page,
        state,
        source === "github" ? "arco_edit_comment" : "linear_comment",
        {
          ...target(source),
          requestId: crypto.randomUUID(),
          commentId:
            source === "github"
              ? (original as Comment).databaseId
              : original.id,
          ...(source === "linear" ? { action: "update" } : {}),
          body,
          expectedUpdatedAt: original.updatedAt,
        },
      ),
  };
}
function savedDraft(
  source: Source,
  original: Comment | LinearComment,
  text: string,
): Draft {
  return {
    title: "",
    body: "",
    comment: text,
    baseUpdatedAt: original.updatedAt,
    ...(source === "linear" ? { baseBody: original.body } : {}),
  };
}

test("a submitted comment draft stays removed after a delayed initial read and new edits still save", async ({
  page,
}) => {
  const state = storage();
  let release!: () => void;
  state.blockedRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.clock.install();
  await intercept(page, "github", state);
  const comment = await commentEditor(page, "github", state);
  const reading = page.waitForRequest((request) => {
    if (!request.url().endsWith("/tool")) return false;
    const input = request.postDataJSON() as ToolInput;
    return (
      input.name === "arco_read_draft" &&
      input.arguments.key?.issue.includes(":comment:") === true
    );
  });
  try {
    await comment.open();
    await reading;
    const submitted = "Submitted while the initial draft read was pending";
    await comment.editor.fill(submitted);
    await page.clock.fastForward(1000);
    await comment.save();
    await expect(comment.editor).toHaveCount(0);
    expect(state.providerWrites.at(-1)?.arguments.body).toBe(submitted);
    release();
    await expect.poll(() => state.writes.length).toBeGreaterThanOrEqual(1);

    await comment.open();
    await comment.editor.fill("A genuinely new unsent edit");
    await page.clock.fastForward(1000);
    await expect
      .poll(() => state.record.draft?.comment)
      .toBe("A genuinely new unsent edit");
    expect(state.writes.map((input) => input.name)).toEqual([
      "arco_delete_draft",
      "arco_write_draft",
    ]);
    expect(state.record.revision).toBe(2);
  } finally {
    release();
  }
});

for (const source of ["github", "linear"] as const) {
  test(`${source} comment input and its source revision survive a delayed initial draft read`, async ({
    page,
  }) => {
    await page.clock.install();
    const state = storage();
    let release!: () => void;
    state.blockedRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    await intercept(page, source, state);
    const form = await commentEditor(page, source, state);
    state.record = {
      revision: 7,
      draft: savedDraft(source, form.original, "Stored comment edit"),
    };
    try {
      await form.open();
      await form.editor.fill("Typed while the draft is loading");
      release();
      await page.clock.fastForward(1000);
      await expect
        .poll(() => state.record.draft?.comment)
        .toBe("Typed while the draft is loading");
      await expect(form.editor).toHaveValue("Typed while the draft is loading");
      expect(state.record.draft).toEqual(
        savedDraft(source, form.original, "Typed while the draft is loading"),
      );
      expect(state.writes[0].arguments.expectedRevision).toBe(7);
      expect(state.providerWrites).toEqual([]);
    } finally {
      release();
    }
  });

  test(`${source} typing after a failed read survives retry and an explicit keep-local choice`, async ({
    page,
  }) => {
    await page.clock.install();
    const state = storage();
    state.readFails = true;
    await intercept(page, source, state);
    const form = await commentEditor(page, source, state);
    state.record = {
      revision: 4,
      draft: savedDraft(source, form.original, "Another saved edit"),
    };
    await form.open();
    await expect(form.container.getByRole("alert")).toContainText(
      "Comment draft read unavailable.",
    );
    await form.editor.fill("Input made after the read failure");
    await page.clock.fastForward(1000);
    await expect(
      form.container.getByRole("button", {
        name: "Retry saving draft",
        exact: true,
      }),
    ).toBeVisible();
    state.readFails = false;
    await form.container
      .getByRole("button", { name: "Retry saving draft", exact: true })
      .click();
    await expect(form.container.getByRole("alert")).toContainText(
      "This draft conflicts with another Arco view",
    );
    await expect(form.editor).toHaveValue("Input made after the read failure");
    await form.container
      .getByText("Compare saved draft", { exact: true })
      .click();
    await form.container
      .getByRole("button", { name: "Save this screen’s draft", exact: true })
      .click();
    await expect(form.container.getByRole("alert")).toHaveCount(0);
    await expect
      .poll(() => state.record.draft)
      .toEqual(
        savedDraft(source, form.original, "Input made after the read failure"),
      );
    expect(state.providerWrites).toEqual([]);
  });

  test(`${source} an untouched editor preserves its source-refresh behavior without creating a draft`, async ({
    page,
  }) => {
    await page.clock.install();
    const state = storage();
    await intercept(page, source, state);
    const form = await commentEditor(page, source, state);
    await form.open();
    await expect(form.editor).toHaveValue(form.original.body);
    await form.update("Changed before local editing");
    await form.refresh();
    await expect(form.editor).toHaveValue(
      source === "github" ? form.original.body : "Changed before local editing",
    );
    expect(state.writes).toEqual([]);
    expect(state.providerWrites).toEqual([]);
  });

  test(`${source} a legacy draft without a baseline keeps its original conflict boundary after source refresh`, async ({
    page,
  }) => {
    await page.clock.install();
    const state = storage();
    await intercept(page, source, state);
    const form = await commentEditor(page, source, state);
    state.record = {
      revision: 3,
      draft: { title: "", body: "", comment: "Legacy unsent edit" },
    };
    await form.open();
    await expect(form.editor).toHaveValue("Legacy unsent edit");
    await form.update("Changed by another fixture view");
    await form.refresh();
    await expect(
      form.container.getByText(
        source === "github"
          ? "The comment on GitHub changed. Compare it with your draft."
          : "The comment changed in Linear. Your draft is preserved.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      form.container.getByRole("button", {
        name: source === "github" ? "Update comment" : "Save",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(form.editor).toHaveValue("Legacy unsent edit");
    expect(state.writes).toEqual([]);
    expect(state.providerWrites).toEqual([]);
  });

  test(`${source} using a saved conflict restores source baselines and successful saving clears only that draft`, async ({
    page,
  }) => {
    await page.clock.install();
    const state = storage();
    await intercept(page, source, state);
    const form = await commentEditor(page, source, state);
    await form.open();
    await form.editor.fill("First local edit");
    await page.clock.fastForward(1000);
    await expect
      .poll(() => state.record.draft?.comment)
      .toBe("First local edit");
    const remote = {
      ...savedDraft(source, form.original, "Saved edit from another view"),
      baseUpdatedAt: "2026-01-01T00:00:00Z",
      ...(source === "linear" ? { baseBody: "An earlier provider body" } : {}),
    };
    state.record = { revision: state.record.revision + 1, draft: remote };
    await form.editor.fill("A conflicting local edit");
    await page.clock.fastForward(1000);
    await expect(form.container.getByRole("alert")).toContainText(
      "This draft conflicts with another Arco view",
    );
    await form.container
      .getByText("Compare saved draft", { exact: true })
      .click();
    await form.container
      .getByRole("button", { name: "Use saved draft", exact: true })
      .click();
    await expect(form.editor).toHaveValue(remote.comment);
    await expect(
      form.container.getByRole("button", {
        name: source === "github" ? "Update comment" : "Save",
        exact: true,
      }),
    ).toBeDisabled();
    expect(state.providerWrites).toEqual([]);
    if (source === "linear") {
      await form.container
        .getByRole("button", { name: "Compare latest comment", exact: true })
        .click();
      await form.container
        .getByRole("button", {
          name: "Keep draft and use latest revision",
          exact: true,
        })
        .click();
    } else {
      await form.container
        .getByRole("button", {
          name: "Use latest revision for this draft",
          exact: true,
        })
        .click();
    }
    await form.save();
    await expect(form.editor).toHaveCount(0);
    await expect.poll(() => state.record.draft).toBeNull();
    expect(state.providerWrites).toHaveLength(1);
    expect(state.providerWrites[0].arguments).toMatchObject({
      body: remote.comment,
      expectedUpdatedAt: form.original.updatedAt,
    });
    expect(
      (await form.read()).comments.find(
        (comment) => comment.id === form.original.id,
      )?.body,
    ).toBe(remote.comment);
    await form.open();
    await expect(form.editor).toHaveValue(remote.comment);
    expect(state.writes.at(-1)?.name).toBe("arco_delete_draft");
    expect(state.writes.at(-1)?.arguments.key).toEqual(
      source === "github"
        ? {
            source,
            repo: "yu/Arco",
            issue: `42:comment:${(form.original as Comment).databaseId}`,
            ownerId: "fixture-github-user",
          }
        : {
            source,
            workspaceId: "fixture-linear-workspace",
            teamId: "fixture-linear-team",
            issue: `fixture-linear-42:comment:${form.original.id}`,
            ownerId: "fixture-linear-user",
          },
    );
  });

  test(`${source} failed comment changes and deletion keep the unsent edit`, async ({
    page,
  }) => {
    await page.clock.install();
    const state = storage();
    await intercept(page, source, state);
    const form = await commentEditor(page, source, state);
    await form.open();
    await form.editor.fill("Unsent edit retained after failure");
    await page.clock.fastForward(1000);
    await expect
      .poll(() => state.record.draft?.comment)
      .toBe("Unsent edit retained after failure");
    state.providerFails = true;
    await form.save();
    await expect(form.ui.getByRole("alert")).toContainText(
      "Comment change unavailable.",
    );
    await expect(form.editor).toHaveValue("Unsent edit retained after failure");
    await form.container
      .getByRole("button", {
        name: source === "github" ? "Close" : "Close and keep draft",
        exact: true,
      })
      .click();
    if (source === "github")
      await form.container
        .getByRole("button", { name: "Delete", exact: true })
        .click();
    else
      await form.container
        .locator("details")
        .getByText("Delete", { exact: true })
        .click();
    await form.container
      .getByRole("button", { name: "Delete this comment", exact: true })
      .click();
    await expect.poll(() => state.providerWrites.length).toBe(2);
    expect(
      (await form.read()).comments.some(
        (comment) => comment.id === form.original.id,
      ),
    ).toBe(true);
    expect(state.record.draft?.comment).toBe(
      "Unsent edit retained after failure",
    );
    expect(
      state.writes.some((write) => write.name === "arco_delete_draft"),
    ).toBe(false);
  });
}
