import { toolFailure } from "./tool-failure";
import { expect, test } from "./browser-test";
import { choose } from "./select-helpers";

test("a GitHub leaf failure returns to its own panel after switching sources and retains its retry ID", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requestIds: string[] = [];
  await page.route("**/tool", async (route) => {
    const call = route.request().postDataJSON() as {
      name: string;
      arguments: { requestId: string };
    };
    if (call.name !== "arco_add_reaction") return route.continue();
    requestIds.push(call.arguments.requestId);
    if (requestIds.length === 1) {
      await held;
      return route.fulfill({
        json: toolFailure("The reaction needs an explicit retry."),
      });
    }
    return route.fulfill({ json: { content: [], structuredContent: {} } });
  });
  try {
    await page.goto("/?entry=project");
    await expect(page.locator("#bridge-status")).toHaveText("ready");
    const ui = page.frameLocator("#arco");
    await choose(ui, "GitHub view", "yu/Arco");
    const reactions = ui.getByLabel("Issue reactions", { exact: true });
    await reactions.scrollIntoViewIfNeeded();
    await reactions
      .getByRole("button", { name: "Choose reaction", exact: true })
      .click();
    await reactions
      .getByRole("button", { name: "rocket 0 Add reaction", exact: true })
      .click();
    await expect.poll(() => requestIds.length).toBe(1);
    await choose(ui, "Issue source", "linear");
    await expect(
      ui.getByRole("heading", {
        name: "Keep Linear workflow states intact",
        exact: true,
      }),
    ).toBeVisible();
    release();
    await choose(ui, "Issue source", "github");
    await reactions.scrollIntoViewIfNeeded();
    await expect(reactions.getByRole("alert")).toContainText(
      "The reaction needs an explicit retry.",
    );
    await expect(
      ui
        .locator(".comment-tools")
        .getByText("The reaction needs an explicit retry.", { exact: true }),
    ).toHaveCount(0);
    await reactions
      .getByRole("button", { name: "Choose reaction", exact: true })
      .click();
    await reactions
      .getByRole("button", { name: "rocket 0 Add reaction", exact: true })
      .click();
    await expect.poll(() => requestIds.length).toBe(2);
    expect(requestIds[1]).toBe(requestIds[0]);
    await expect(reactions.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("#harness-error")).toBeEmpty();
  } finally {
    release();
  }
});
