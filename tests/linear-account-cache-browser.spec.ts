import { expect, test } from "./browser-test";
import { toolFailure } from "./tool-failure";

test("an initial Linear connection for another account cannot use the launch account's snapshot", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "linear_connection") {
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.userId = "another-linear-user";
      result.structuredContent.account = "another-linear-user";
      result.structuredContent.authGeneration = "another-linear-generation";
      return route.fulfill({ response, json: result });
    }
    if (input.name === "linear_get_issue")
      return route.fulfill({
        json: toolFailure(
          "This account cannot read the launch issue.",
          "forbidden",
        ),
      });
    return route.continue();
  });
  const targets = [42, 43].map((number) => ({
    source: "linear",
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-linear-team",
    issueId: `fixture-linear-${number}`,
  }));
  await page.goto(
    `/?entry=issues&targets=${encodeURIComponent(JSON.stringify(targets))}`,
  );
  const ui = page.frameLocator("#arco");
  await expect(
    ui.getByRole("heading", { name: "Could not load Linear", exact: true }),
  ).toBeVisible();
  await expect(
    ui.getByRole("heading", {
      name: "Keep Linear workflow states intact",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator("#harness-error")).toBeEmpty();
});

for (const switchAccount of [false, true]) {
  test(`Linear ${switchAccount ? "clears the previous account's" : "retains the current account's"} cached issues when refresh fails`, async ({
    page,
  }) => {
    let owner = "fixture-linear-user";
    let failReads = false;
    let connectionReads = 0;
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      if (input.name === "linear_connection") {
        const response = await route.fetch();
        const result = await response.json();
        result.structuredContent.userId = owner;
        result.structuredContent.account = owner;
        connectionReads++;
        return route.fulfill({ response, json: result });
      }
      if (
        failReads &&
        ["linear_get_issue", "linear_list_issues", "linear_comments"].includes(
          input.name,
        )
      )
        return route.fulfill({
          json: toolFailure("This account cannot read the issue.", "forbidden"),
        });
      return route.continue();
    });
    await page.goto("/?source=linear");
    const ui = page.frameLocator("#arco");
    const oldTitle = "Keep Linear workflow states intact";
    await expect(
      ui.getByRole("heading", { name: oldTitle, exact: true }),
    ).toBeVisible();
    const before = connectionReads;
    if (switchAccount) owner = "another-linear-user";
    failReads = true;
    await ui
      .getByRole("button", { name: "Refresh Linear", exact: true })
      .click();
    await expect.poll(() => connectionReads).toBeGreaterThan(before);
    await expect(
      ui
        .getByText("This account cannot read the issue.", { exact: false })
        .first(),
    ).toBeVisible();
    if (switchAccount) {
      await expect(
        ui.getByRole("heading", { name: oldTitle, exact: true }),
      ).toHaveCount(0);
      await expect(
        ui.locator(".issue-row").filter({ hasText: oldTitle }),
      ).toHaveCount(0);
      await expect(
        ui.getByRole("textbox", { name: "Linear comment", exact: true }),
      ).toHaveCount(0);
    } else {
      await expect(
        ui.getByRole("heading", { name: oldTitle, exact: true }),
      ).toBeVisible();
      await expect(
        ui.locator(".issue-row").filter({ hasText: oldTitle }),
      ).toBeVisible();
    }
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}

for (const returnToOriginal of [false, true]) {
  test(`a delayed Linear write acknowledgement cannot replace the current account's issue cache${returnToOriginal ? " after an account round trip" : ""}`, async ({
    page,
  }) => {
    let owner = "fixture-linear-user";
    let generation = 0;
    let failReads = false;
    let writeAccepted = false;
    let writeDelivered = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { action?: string };
      };
      if (input.name === "linear_connection") {
        const response = await route.fetch();
        const result = await response.json();
        result.structuredContent.userId = owner;
        result.structuredContent.account = owner;
        result.structuredContent.authGeneration = `linear-generation-${generation}`;
        return route.fulfill({ response, json: result });
      }
      if (
        input.name === "linear_comment" &&
        input.arguments.action === "create"
      ) {
        const response = await route.fetch();
        writeAccepted = true;
        await pending;
        await route.fulfill({ response });
        writeDelivered = true;
        return;
      }
      if (input.name !== "linear_get_issue") return route.continue();
      if (failReads)
        return route.fulfill({
          json: toolFailure("The new account's refresh is unavailable."),
        });
      const response = await route.fetch();
      const result = await response.json();
      if (generation > 0)
        result.structuredContent.title = `Current account's issue snapshot ${generation}`;
      return route.fulfill({ response, json: result });
    });
    try {
      await page.goto("/?source=linear");
      const ui = page.frameLocator("#arco");
      await expect(
        ui.getByRole("heading", {
          name: "Keep Linear workflow states intact",
          exact: true,
        }),
      ).toBeVisible();
      await ui
        .getByRole("textbox", { name: "Linear comment", exact: true })
        .fill("Account A's submitted comment");
      await ui.getByRole("button", { name: "Comment", exact: true }).click();
      await expect.poll(() => writeAccepted).toBe(true);
      owner = "another-linear-user";
      generation++;
      await ui
        .getByRole("button", { name: "Refresh Linear", exact: true })
        .click();
      const current = ui.getByRole("heading", {
        name: `Current account's issue snapshot ${generation}`,
        exact: true,
      });
      await expect(current).toBeVisible();
      if (returnToOriginal) {
        owner = "fixture-linear-user";
        generation++;
        await ui
          .getByRole("button", { name: "Refresh Linear", exact: true })
          .click();
        await expect(
          ui.getByRole("heading", {
            name: `Current account's issue snapshot ${generation}`,
            exact: true,
          }),
        ).toBeVisible();
      }
      failReads = true;
      release();
      await expect.poll(() => writeDelivered).toBe(true);
      await expect(
        ui.getByRole("textbox", { name: "Linear comment", exact: true }),
      ).toBeEnabled();
      await expect(
        ui.getByRole("heading", {
          name: `Current account's issue snapshot ${generation}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        ui.getByRole("heading", {
          name: "Keep Linear workflow states intact",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(page.locator("#harness-error")).toBeEmpty();
    } finally {
      release();
    }
  });
}

test("switching display mode cannot restore a Linear launch snapshot from the previous account", async ({
  page,
}) => {
  let owner = "fixture-linear-user";
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "linear_connection") {
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.userId = owner;
      result.structuredContent.account = owner;
      return route.fulfill({ response, json: result });
    }
    if (
      owner !== "fixture-linear-user" &&
      ["linear_get_issue", "linear_list_issues", "arco_show_issues"].includes(
        input.name,
      )
    )
      return route.fulfill({
        json: toolFailure(
          "This account cannot read the launch issue.",
          "forbidden",
        ),
      });
    return route.continue();
  });
  const targets = [42, 43].map((number) => ({
    source: "linear",
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-linear-team",
    issueId: `fixture-linear-${number}`,
  }));
  await page.goto(
    `/?entry=issues&targets=${encodeURIComponent(JSON.stringify(targets))}`,
  );
  const ui = page.frameLocator("#arco");
  const title = ui.getByRole("heading", {
    name: "Keep Linear workflow states intact",
    exact: true,
  });
  await expect(title).toBeVisible();
  await page
    .getByRole("button", { name: "Mock fullscreen", exact: true })
    .click();
  await expect(
    ui.getByRole("button", { name: "Refresh Linear", exact: true }),
  ).toBeVisible();
  owner = "another-linear-user";
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  await expect(
    ui
      .getByText("This account cannot read the launch issue.", { exact: false })
      .first(),
  ).toBeVisible();
  await expect(title).toHaveCount(0);
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(
    ui.getByRole("heading", { name: "Could not load Linear", exact: true }),
  ).toBeVisible();
  await expect(title).toHaveCount(0);
  await expect(page.locator("#harness-error")).toBeEmpty();
});

test("a later received Linear presentation from an old generation cannot replace current tabs or details", async ({
  page,
}) => {
  let generation = "fixture-linear-generation";
  let stalePresentation = false;
  let staleResponseDelivered = false;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (
      !["linear_connection", "linear_get_issue", "arco_show_issues"].includes(
        input.name,
      )
    )
      return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    if (input.name === "linear_connection") {
      result.structuredContent.authGeneration = generation;
      result.structuredContent.userId = generation;
    } else if (generation !== "fixture-linear-generation") {
      if (input.name === "linear_get_issue") {
        result.structuredContent.title = "Current account's issue";
        result.structuredContent.body = "Current account's body";
      } else if (!stalePresentation) {
        for (const issue of result.structuredContent.launch.issues)
          issue.title = `Current account's ${issue.identifier}`;
        for (const issue of result._meta.issueDetails) {
          issue.title = `Current account's ${issue.identifier}`;
          issue.body = "Current account's body";
        }
        result._meta.linearAuthGenerations = { default: generation };
      }
    }
    await route.fulfill({ response, json: result });
    if (input.name === "arco_show_issues" && stalePresentation)
      staleResponseDelivered = true;
  });
  const targets = [42, 43].map((number) => ({
    source: "linear",
    connectionId: "default",
    workspaceId: "fixture-linear-workspace",
    teamId: "fixture-linear-team",
    issueId: `fixture-linear-${number}`,
  }));
  await page.goto(
    `/?entry=issues&targets=${encodeURIComponent(JSON.stringify(targets))}`,
  );
  const ui = page.frameLocator("#arco");
  await expect(
    ui.getByRole("heading", {
      name: "Keep Linear workflow states intact",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mock fullscreen", exact: true })
    .click();
  generation = "next-linear-generation";
  await ui.getByRole("button", { name: "Refresh Linear", exact: true }).click();
  await expect(
    ui.getByRole("heading", { name: "Current account's issue", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  const tabs = ui.getByRole("tablist", { name: "Issues", exact: true });
  await expect(tabs.getByRole("tab").first()).toContainText(
    "Current account's YU-42",
  );
  stalePresentation = true;
  await page
    .getByRole("button", { name: "Mock external update #42", exact: true })
    .click();
  await expect.poll(() => staleResponseDelivered).toBe(true);
  await expect(
    ui.getByText("Linear authentication changed. Refresh these issues.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(tabs.getByRole("tab").first()).toContainText(
    "Current account's YU-42",
  );
  await expect(
    ui.getByRole("heading", {
      name: "Keep Linear workflow states intact",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator("#harness-error")).toBeEmpty();
});
