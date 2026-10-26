import { expect, test, type Page } from "./browser-test";
import { toolFailure } from "./tool-failure";

const initialScope = "fixture-github-session";
const image =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jpT0AAAAASUVORK5CYII=";
const app = (page: Page) => page.frameLocator("#arco");
type Phase = {
  scope: string;
  account: string | null;
  deny: boolean;
  notFound?: boolean;
};

async function controlledSource(page: Page) {
  const state = {
    phase: { scope: initialScope, account: "account-a", deny: false } as Phase,
    session: "",
    connections: 0,
    hold: false,
    held: false,
    release: () => {},
  };
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      session: string;
      name: string;
      arguments: { number?: number; url?: string };
    };
    state.session = input.session;
    const phase = { ...state.phase };
    if (input.name === "arco_connection") {
      state.connections++;
      return route.fulfill({
        json: {
          structuredContent: {
            mode: "fixture",
            connected: phase.account !== null,
            account: phase.account,
            userId:
              phase.account === null ? null : `fictional-user-${phase.account}`,
            authGeneration: phase.scope,
            message: "Controlled fixture authentication",
          },
        },
      });
    }
    const providerRead = [
      "arco_get_issue",
      "arco_list_issues",
      "arco_account_issues",
      "arco_comments",
      "arco_read_image",
      "arco_repo_metadata",
      "arco_repositories",
      "arco_show_issues",
    ].includes(input.name);
    if (phase.deny && providerRead)
      return route.fulfill({
        json: toolFailure(
          "Current account cannot read this issue.",
          phase.notFound ? "not-found" : "forbidden",
        ),
      });
    if (input.name === "arco_read_image")
      return route.fulfill({
        json: {
          structuredContent: {},
          _meta: {
            image: {
              mimeType: "image/png",
              data: image,
              sourceUrl: input.arguments.url,
            },
          },
        },
      });
    if (!["arco_get_issue", "arco_show_issues"].includes(input.name))
      return route.fallback();
    const response = await route.fetch();
    const result = await response.json();
    const owner = phase.account === "account-b" ? "B" : "A";
    const details =
      input.name === "arco_show_issues"
        ? result._meta.issueDetails
        : [result.structuredContent];
    for (const issue of details) {
      if (issue.source !== "github") continue;
      issue.title = `Private ${owner} issue ${issue.number}`;
      issue.body = `Private ${owner} source body\n\n![Private ${owner} preview](https://example.com/private-${owner}.png)`;
      if (issue.comments[0])
        issue.comments[0].body = `Private ${owner} comment`;
    }
    if (input.name === "arco_show_issues") {
      result._meta.githubAuthGeneration = phase.scope;
      for (const summary of result.structuredContent.launch.issues)
        if (summary.source === "github")
          summary.title = `Private ${owner} issue ${summary.number}`;
    }
    if (state.hold && input.name === "arco_get_issue") {
      state.held = true;
      await new Promise<void>((resolve) => {
        state.release = resolve;
      });
    }
    return route.fulfill({ response, json: result });
  });
  return state;
}

async function events(page: Page, type: string) {
  const log = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  ) as {
    type: string;
    value: unknown;
  }[];
  return log.filter((event) => event.type === type).map((event) => event.value);
}

for (const change of ["account", "rotation", "disconnect"] as const) {
  test(`${change} change stops cached GitHub content while preserving drafts and existing chat attachments`, async ({
    page,
  }) => {
    const state = await controlledSource(page);
    await page.goto("/?entry=project");
    const ui = app(page);
    await expect(
      ui.getByRole("heading", { name: "Private A issue 42", exact: true }),
    ).toBeVisible();
    await expect(
      ui.getByText("Private A comment", { exact: true }),
    ).toBeVisible();
    await expect(
      ui.getByRole("img", { name: "Private A preview" }),
    ).toBeVisible();
    await ui
      .getByRole("textbox", { name: "Comment on GitHub", exact: true })
      .fill("Keep account A unsent input");
    await ui.getByRole("button", { name: "Add to chat", exact: true }).click();
    await expect.poll(() => events(page, "context")).toHaveLength(1);
    const attachment = await events(page, "context");
    state.phase = {
      scope: "observed-other-session",
      account:
        change === "disconnect"
          ? null
          : change === "rotation"
            ? "account-a"
            : "account-b",
      deny: true,
      notFound: change === "rotation",
    };
    const before = state.connections;
    await ui.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => state.connections).toBeGreaterThan(before);
    await expect(
      ui.getByRole("heading", { name: "Private A issue 42", exact: true }),
    ).toHaveCount(0);
    await expect(
      ui.getByText("Private A source body", { exact: true }),
    ).toHaveCount(0);
    await expect(
      ui.getByText("Private A comment", { exact: true }),
    ).toHaveCount(0);
    await expect(
      ui.getByRole("img", { name: "Private A preview" }),
    ).toHaveCount(0);
    await expect(
      ui.getByRole("button", { name: "Add to chat", exact: true }),
    ).toHaveCount(0);
    if (change === "disconnect") {
      state.phase = {
        scope: "reconnected-b",
        account: "account-b",
        deny: true,
      };
      await ui
        .getByRole("button", { name: "Check connection", exact: true })
        .click();
      await expect(
        ui.getByRole("heading", { name: "Private A issue 42", exact: true }),
      ).toHaveCount(0);
    }
    await expect
      .poll(async () => {
        const response = await page.request.post("/tool", {
          data: {
            session: state.session,
            name: "arco_read_draft",
            arguments: {
              key: {
                source: "github",
                repo: "yu/Arco",
                issue: "42",
                ownerId: "fictional-user-account-a",
              },
            },
          },
        });
        return (await response.json()).structuredContent.draft?.comment;
      })
      .toBe("Keep account A unsent input");
    expect(await events(page, "context")).toEqual(attachment);
    expect(await events(page, "message")).toEqual([]);
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}

test("an unconfirmed comment retains its original request ID after an observed account change", async ({
  page,
}) => {
  const state = await controlledSource(page);
  const requestIds: string[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { requestId: string };
    };
    if (input.name !== "arco_comment") return route.fallback();
    requestIds.push(input.arguments.requestId);
    return route.fulfill({
      json: toolFailure("The comment result is unconfirmed.", "uncertain"),
    });
  });
  await page.goto("/?entry=project");
  const ui = app(page);
  await expect(
    ui.getByRole("heading", { name: "Private A issue 42", exact: true }),
  ).toBeVisible();
  const body = "Keep the original uncertain account A comment request.";
  await ui
    .getByRole("textbox", { name: "Comment on GitHub", exact: true })
    .fill(body);
  await ui.getByRole("button", { name: "Comment", exact: true }).click();
  await expect.poll(() => requestIds.length).toBe(1);
  await expect(
    ui
      .getByRole("alert")
      .filter({ hasText: "The comment result is unconfirmed." }),
  ).toBeVisible();
  state.phase = {
    scope: "uncertain-new-account",
    account: "account-b",
    deny: false,
  };
  await ui.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    ui.getByRole("heading", { name: "Private B issue 42", exact: true }),
  ).toBeVisible();
  expect(requestIds).toHaveLength(1);
  await ui
    .getByRole("textbox", { name: "Comment on GitHub", exact: true })
    .fill(body);
  await ui.getByRole("button", { name: "Comment", exact: true }).click();
  await expect.poll(() => requestIds.length).toBe(2);
  expect(requestIds[1]).toBe(requestIds[0]);
});

test("a response started under the previous authentication cannot restore its body after a denied switch", async ({
  page,
}) => {
  const state = await controlledSource(page);
  try {
    await page.goto("/?entry=project");
    const ui = app(page);
    await expect(
      ui.getByRole("heading", { name: "Private A issue 42", exact: true }),
    ).toBeVisible();
    state.hold = true;
    await ui.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => state.held).toBe(true);
    state.hold = false;
    state.phase = { scope: "late-switch-b", account: "account-b", deny: true };
    const before = state.connections;
    await ui.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => state.connections).toBeGreaterThan(before);
    await expect(
      ui.getByRole("heading", { name: "Private A issue 42", exact: true }),
    ).toHaveCount(0);
    state.release();
    await expect(
      ui.getByText("Private A source body", { exact: true }),
    ).toHaveCount(0);
    await expect(
      ui.getByRole("img", { name: "Private A preview" }),
    ).toHaveCount(0);
  } finally {
    state.release();
  }
});

test("a new account shares only its freshly fetched source payload", async ({
  page,
}) => {
  const state = await controlledSource(page);
  await page.goto("/?entry=project");
  const ui = app(page);
  await expect(
    ui.getByRole("heading", { name: "Private A issue 42", exact: true }),
  ).toBeVisible();
  state.phase = {
    scope: "authorized-account-b",
    account: "account-b",
    deny: false,
  };
  await ui.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    ui.getByRole("heading", { name: "Private B issue 42", exact: true }),
  ).toBeVisible();
  await expect(
    ui.getByText("Private A source body", { exact: true }),
  ).toHaveCount(0);
  await expect(
    ui.getByRole("img", { name: "Private B preview" }),
  ).toBeVisible();
  await ui.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => events(page, "context")).toHaveLength(1);
  const payload = JSON.stringify(await events(page, "context"));
  expect(payload).toContain("Private B source body");
  expect(payload).not.toContain("Private A source body");
  expect(await events(page, "message")).toEqual([]);
});

test("an old grouped presentation cannot reseed the next authentication after returning inline", async ({
  page,
}) => {
  const state = await controlledSource(page);
  await page.goto("/?entry=issues");
  const ui = app(page);
  await expect(
    ui.getByRole("heading", { name: "Private A issue 42", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mock fullscreen", exact: true })
    .click();
  state.phase = {
    scope: "grouped-account-b",
    account: "account-b",
    deny: true,
  };
  await ui.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    ui.getByRole("heading", { name: "Private A issue 42", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(
    ui.getByRole("button", { name: "Retry refresh", exact: true }),
  ).toBeVisible();
  await expect(
    ui.getByRole("tab", { name: /^yu\/Arco #42 Private A/ }),
  ).toHaveCount(0);
  await expect(
    ui.getByText("Private A source body", { exact: true }),
  ).toHaveCount(0);
  await expect(ui.getByRole("img", { name: "Private A preview" })).toHaveCount(
    0,
  );
});

test("a GitHub selection cannot create a new chat attachment after authentication changes during its snapshot write", async ({
  page,
}) => {
  const state = await controlledSource(page);
  let held = false;
  let release = () => {};
  let hold = true;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== "arco_write_annotation_snapshot" || !hold)
      return route.fallback();
    const response = await route.fetch();
    held = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return route.fulfill({ response });
  });
  await page.goto("/?entry=project");
  const ui = app(page);
  const selectHeading = async (title: string) => {
    const heading = ui.getByRole("heading", { name: title, exact: true });
    await expect(heading).toBeVisible();
    await heading.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selected = window.getSelection()!;
      selected.removeAllRanges();
      selected.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    return ui.getByRole("toolbar", { name: "Text selection", exact: true });
  };
  try {
    const toolbar = await selectHeading("Private A issue 42");
    await toolbar
      .getByRole("button", { name: "Add to chat", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    state.phase = {
      scope: "selection-account-b",
      account: "account-b",
      deny: false,
    };
    await ui.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      ui.getByRole("heading", { name: "Private B issue 42", exact: true }),
    ).toBeVisible();
    const completed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/tool") &&
        response.request().postDataJSON()?.name ===
          "arco_write_annotation_snapshot",
    );
    hold = false;
    release();
    await completed;
    await ui
      .locator("body")
      .evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    expect(await events(page, "context")).toEqual([]);
    expect(await events(page, "message")).toEqual([]);
    const next = await selectHeading("Private B issue 42");
    await next
      .getByRole("button", { name: "Add to chat", exact: true })
      .click();
    await expect.poll(() => events(page, "context")).toHaveLength(1);
    const payload = JSON.stringify(await events(page, "context"));
    expect(payload).toContain("Private B issue 42");
    expect(payload).not.toContain("Private A issue 42");
    expect(payload).not.toContain("selection-account-b");
  } finally {
    release();
  }
});
