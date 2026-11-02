import { expect, test, type Page } from "./browser-test";
import type { Draft, DraftKey } from "../src/shared/state";

type Source = "github" | "linear";
async function accounts(page: Page, source: Source) {
  const ownerA =
    source === "github" ? "fixture-github-user" : "fixture-linear-user";
  const state = {
    owner: ownerA,
    generation: 0,
    session: "",
    holdA: false,
    writes: [] as { key: DraftKey; draft: Draft }[],
    completed: [] as DraftKey[],
  };
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      session: string;
      name: string;
      arguments: { key?: DraftKey; draft?: Draft };
    };
    state.session = input.session;
    if (
      input.name ===
      (source === "github" ? "arco_connection" : "linear_connection")
    ) {
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.userId = state.owner;
      result.structuredContent.account = `${state.owner}-${state.generation}`;
      result.structuredContent.authGeneration = `local-generation-${state.generation}`;
      return route.fulfill({ response, json: result });
    }
    if (
      source === "linear" &&
      ["linear_get_issue", "arco_open_issue"].includes(input.name)
    ) {
      const response = await route.fetch();
      const result = await response.json();
      const issue =
        input.name === "linear_get_issue"
          ? result.structuredContent
          : result.structuredContent?.issue;
      if (issue?.source === "linear")
        issue.comments = [
          {
            id: "owned-comment",
            body: "Source comment",
            author: "Fixture user",
            authorId: ownerA,
            parentId: null,
            updatedAt: issue.updatedAt,
            url: `${issue.url}#owned-comment`,
            reactions: [],
          },
        ];
      return route.fulfill({ response, json: result });
    }
    if (
      input.name === "arco_write_draft" &&
      input.arguments.key &&
      input.arguments.draft
    ) {
      const key = structuredClone(input.arguments.key);
      state.writes.push({ key, draft: structuredClone(input.arguments.draft) });
      if (state.holdA && key.ownerId === ownerA) await blocked;
      const response = await route.fetch();
      state.completed.push(key);
      return route.fulfill({ response });
    }
    return route.continue();
  });
  const ui = page.frameLocator("#arco");
  const refresh = () =>
    ui
      .getByRole("button", {
        name: source === "github" ? "Refresh" : "Refresh Linear",
        exact: true,
      })
      .click();
  const switchOwner = async (owner: string) => {
    state.owner = owner;
    state.generation++;
    await refresh();
    if (source === "github")
      await expect(
        ui
          .locator(
            `[data-arco-github-auth-generation="local-generation-${state.generation}"]`,
          )
          .first(),
      ).toBeVisible();
    await expect(
      ui.getByRole("heading", {
        name:
          source === "github"
            ? "Preserve issue selection and scroll position"
            : "Keep Linear workflow states intact",
        exact: true,
      }),
    ).toBeVisible();
  };
  return { ui, state, ownerA, ownerB: `${ownerA}-other`, release, switchOwner };
}

const location = (source: Source) =>
  source === "github"
    ? "/?entry=detail&issueRepo=yu/Arco&number=42"
    : "/?entry=detail&source=linear&number=42";
async function editBody(page: Page, source: Source) {
  const ui = page.frameLocator("#arco");
  const field = ui.getByRole("textbox", {
    name: source === "github" ? "Issue body" : "Linear Markdown description",
    exact: true,
  });
  if (!(await field.count())) {
    await ui.locator('summary[aria-label="Issue actions"]').click();
    await ui
      .getByRole("button", {
        name: source === "github" ? "Edit issue" : "Edit Linear description",
        exact: true,
      })
      .click();
  }
  return field;
}

for (const source of ["github", "linear"] as const) {
  test(`${source} renders consecutive edits while the draft remains pending`, async ({
    page,
  }) => {
    const { state } = await accounts(page, source);
    await page.goto(location(source));
    const body = await editBody(page, source);
    await body.fill("First edit");
    await body.fill("Second edit");
    await body.pressSequentially(" with consecutive keystrokes");
    const expected = "Second edit with consecutive keystrokes";
    await expect(body).toHaveValue(expected);
    await expect
      .poll(() => state.writes.some((write) => write.draft.body === expected))
      .toBe(true);
  });

  test(`${source} same-issue drafts stay with their account across rotation, switching, and a delayed flush`, async ({
    page,
  }) => {
    const setup = await accounts(page, source);
    const { state, ownerA, ownerB, switchOwner, release } = setup;
    try {
      await page.goto(location(source));
      const body = await editBody(page, source);
      const original = await body.inputValue();
      await body.fill("Account A's unsent body");
      await expect
        .poll(() =>
          state.completed.some(
            (key) => !key.issue.includes(":comment:") && key.issue !== "new",
          ),
        )
        .toBe(true);
      await switchOwner(ownerA);
      await expect(await editBody(page, source)).toHaveValue(
        "Account A's unsent body",
      );
      state.holdA = true;
      await (await editBody(page, source)).fill("Account A's late input");
      await switchOwner(ownerB);
      await expect(body).toHaveCount(0);
      const otherBody = await editBody(page, source);
      await expect(otherBody).toHaveValue(original);
      await otherBody.fill("Account B's unsent body");
      await expect
        .poll(() => state.completed.some((key) => key.ownerId === ownerB))
        .toBe(true);
      release();
      await expect
        .poll(() =>
          state.writes.some(
            ({ key, draft }) =>
              key.ownerId === ownerA && draft.body === "Account A's late input",
          ),
        )
        .toBe(true);
      await switchOwner(ownerA);
      await expect(await editBody(page, source)).toHaveValue(
        "Account A's late input",
      );
      expect(
        state.writes
          .filter(({ key }) => key.ownerId === ownerB)
          .every(({ draft }) => !draft.body.includes("Account A")),
      ).toBe(true);
      expect(
        state.writes.every(
          ({ key }) => !JSON.stringify(key).includes("generation"),
        ),
      ).toBe(true);
    } finally {
      release();
    }
  });

  test(`${source} creation input is reset for a new account and restored for the original owner`, async ({
    page,
  }) => {
    const { ui, state, ownerA, ownerB, switchOwner, release } = await accounts(
      page,
      source,
    );
    try {
      await page.goto(location(source));
      const name = source === "github" ? "Create issue" : "Create Linear Issue";
      await ui.getByRole("button", { name, exact: true }).click();
      const dialog = ui.getByRole("dialog", { name, exact: true });
      await dialog
        .getByRole("textbox", { name: "Title", exact: true })
        .fill("Account A's new issue");
      await expect
        .poll(() => state.completed.some((key) => key.issue === "new"))
        .toBe(true);
      await dialog
        .getByRole("button", {
          name:
            source === "github"
              ? "Close create issue"
              : "Close create Linear Issue",
          exact: true,
        })
        .click();
      await switchOwner(ownerB);
      await ui.getByRole("button", { name, exact: true }).click();
      await expect(
        dialog.getByRole("textbox", { name: "Title", exact: true }),
      ).toHaveValue("");
      await dialog
        .getByRole("button", {
          name:
            source === "github"
              ? "Close create issue"
              : "Close create Linear Issue",
          exact: true,
        })
        .click();
      await switchOwner(ownerA);
      await ui.getByRole("button", { name, exact: true }).click();
      await expect(
        dialog.getByRole("textbox", { name: "Title", exact: true }),
      ).toHaveValue("Account A's new issue");
      expect(state.writes.filter(({ key }) => key.ownerId === ownerB)).toEqual(
        [],
      );
    } finally {
      release();
    }
  });

  test(`${source} a comment editor cannot carry one account's unsent text into another account`, async ({
    page,
  }) => {
    const { ui, state, ownerA, ownerB, switchOwner, release } = await accounts(
      page,
      source,
    );
    try {
      await page.goto(location(source));
      const comment = ui
        .locator(source === "github" ? ".comment" : ".linear-comment")
        .first();
      await comment.getByRole("button", { name: "Edit", exact: true }).click();
      const field = ui.getByRole("textbox", {
        name: source === "github" ? "Edit comment" : "Edit Linear comment",
        exact: true,
      });
      await field.fill("Account A's unsent comment edit");
      await expect
        .poll(() =>
          state.completed.some((key) => key.issue.includes(":comment:")),
        )
        .toBe(true);
      await switchOwner(ownerB);
      await expect(field).toHaveCount(0);
      await switchOwner(ownerA);
      await comment.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(field).toHaveValue("Account A's unsent comment edit");
      expect(state.writes.filter(({ key }) => key.ownerId === ownerB)).toEqual(
        [],
      );
    } finally {
      release();
    }
  });
}

for (const kind of ["issue", "project"] as const) {
  test(`github ${kind} field input stays with its stable owner and retains its conflict baseline`, async ({
    page,
  }) => {
    const { ui, state, ownerA, ownerB, switchOwner, release } = await accounts(
      page,
      "github",
    );
    const label = kind === "issue" ? "Summary value" : "Notes value";
    const read = kind === "issue" ? "arco_issue_fields" : "arco_project_fields";
    const fieldId = kind === "issue" ? 101 : "fixture-project-text";
    const providerWrites: string[] = [];
    let holdRead = false;
    let readHeld = false;
    let readCompleted = false;
    let releaseRead!: () => void;
    const pendingRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      if (
        ["arco_set_issue_field", "arco_set_project_field"].includes(input.name)
      )
        providerWrites.push(input.name);
      if (input.name !== read) return route.fallback();
      const { owner, generation } = state;
      const response = await route.fetch();
      const result = await response.json();
      const field = result.structuredContent.fields.find(
        (field: { id: string | number }) => field.id === fieldId,
      );
      field.value =
        owner === ownerB
          ? "B's current source value"
          : generation
            ? "A's updated source value"
            : "A's original source value";
      const held = holdRead;
      if (held) {
        holdRead = false;
        readHeld = true;
        await pendingRead;
      }
      await route.fulfill({ response, json: result });
      if (held) readCompleted = true;
    });
    const openField = async () => {
      const properties = ui.locator(".property-advanced");
      if ((await properties.getAttribute("open")) === null)
        await ui.getByText("More properties", { exact: true }).click();
      const attributes = properties.locator(".advanced-section").filter({
        has: ui.getByText("Edit attributes and membership", { exact: true }),
      });
      if ((await attributes.getAttribute("open")) === null)
        await ui
          .getByText("Edit attributes and membership", { exact: true })
          .click();
      if (kind === "project") {
        const membership = ui.locator(".project-membership").first();
        if ((await membership.getAttribute("open")) === null)
          await membership.locator("summary").first().click();
      }
      return ui
        .locator(".field-editor")
        .filter({ has: ui.getByRole("textbox", { name: label, exact: true }) });
    };
    try {
      await page.goto(location("github"));
      const field = await openField();
      const input = field.getByRole("textbox", { name: label, exact: true });
      await expect(input).toHaveValue("A's original source value");
      await input.fill("A's unsent field input");
      await switchOwner(ownerA);
      await openField();
      await expect(input).toHaveValue("A's unsent field input");
      await expect(field).toContainText("A's updated source value");
      await expect(
        field.getByRole("button", { name: "Save", exact: true }),
      ).toBeDisabled();
      if (kind === "project") {
        holdRead = true;
        await ui.getByRole("button", { name: "Refresh", exact: true }).click();
        await expect.poll(() => readHeld).toBe(true);
      }
      await switchOwner(ownerB);
      await expect(input).toHaveCount(0);
      const other = await openField();
      await expect(
        other.getByRole("textbox", { name: label, exact: true }),
      ).toHaveValue("B's current source value");
      await expect(other.locator(".inline-error")).toHaveCount(0);
      await other
        .getByRole("textbox", { name: label, exact: true })
        .fill("B's own field input");
      if (kind === "project") {
        releaseRead();
        await expect.poll(() => readCompleted).toBe(true);
        await expect(
          other.getByRole("textbox", { name: label, exact: true }),
        ).toHaveValue("B's own field input");
        await expect(other).not.toContainText("A's updated source value");
      }
      await switchOwner(ownerA);
      await expect(input).toHaveCount(0);
      const restored = await openField();
      await expect(
        restored.getByRole("textbox", { name: label, exact: true }),
      ).toHaveValue("A's unsent field input");
      await expect(restored).toContainText("A's updated source value");
      await expect(
        restored.getByRole("button", { name: "Save", exact: true }),
      ).toBeDisabled();
      expect(providerWrites).toEqual([]);
    } finally {
      releaseRead();
      release();
    }
  });
}

for (const source of ["github", "linear"] as const) {
  test(`${source} legacy content appears only after review and import is an explicit owned copy`, async ({
    page,
  }) => {
    const { ui, state, ownerA, release } = await accounts(page, source);
    const issue = source === "github" ? "42" : "fixture-linear-42";
    const older: Draft = {
      title: "Older private title",
      body: "Older private body",
      comment: "Older private comment",
      githubLabels: ["old-label"],
      linearDescriptionTouched: true,
    };
    let legacyReads = 0;
    let imported = false;
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { key?: DraftKey; draft?: Draft };
      };
      if (
        input.arguments.key?.source !== source ||
        input.arguments.key.issue !== issue
      )
        return route.fallback();
      if (input.name === "arco_write_draft") imported = true;
      if (input.name !== "arco_read_draft") return route.fallback();
      if (!input.arguments.key.ownerId) {
        legacyReads++;
        return route.fulfill({
          json: { structuredContent: { revision: 3, draft: older } },
        });
      }
      if (!imported)
        return route.fulfill({
          json: {
            structuredContent: {
              revision: 0,
              draft: null,
              legacyAvailable: true,
            },
          },
        });
      return route.fallback();
    });
    try {
      await page.goto(location(source));
      const review = ui.getByRole("button", {
        name: "Review older draft",
        exact: true,
      });
      await expect(review).toBeVisible();
      expect(legacyReads).toBe(0);
      await expect(
        ui.getByRole("textbox", { name: "Saved body", exact: true }),
      ).toHaveCount(0);
      await review.click();
      await expect(
        ui.getByRole("textbox", { name: "Saved body", exact: true }),
      ).toHaveValue(older.body);
      expect(legacyReads).toBe(1);
      expect(state.writes).toEqual([]);
      await ui
        .getByRole("button", {
          name: "Import older draft into this account",
          exact: true,
        })
        .click();
      await expect.poll(() => state.completed.length).toBe(1);
      expect(state.writes[0]).toMatchObject({
        key: { ownerId: ownerA },
        draft: older,
      });
      await expect(await editBody(page, source)).toHaveValue(older.body);
      await expect(
        ui.getByRole("textbox", {
          name: source === "github" ? "Comment on GitHub" : "Linear comment",
          exact: true,
        }),
      ).toHaveValue(older.comment);
      await page
        .getByRole("button", {
          name:
            source === "github"
              ? "Mock external update #42"
              : "Mock Linear external update YU-42",
          exact: true,
        })
        .click();
      await expect(
        ui.getByRole("alert", { name: "Content conflict", exact: true }),
      ).toBeVisible();
      await expect(await editBody(page, source)).toHaveValue(older.body);
      expect(older.body).toBe("Older private body");
    } finally {
      release();
    }
  });
}
