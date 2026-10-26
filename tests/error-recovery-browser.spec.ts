import { expect, test } from "./browser-test";
import { toolFailure } from "./tool-failure";
import { commandError } from "../src/server/github/transport";

const title = "Preserve issue selection and scroll position";

for (const [kind, stderr, guidance] of [
  ["auth", "gh: Bad credentials (HTTP 401)", "Check gh auth login"],
  [
    "forbidden",
    "gh: Resource not accessible by integration (HTTP 403)",
    "Check the target and your GitHub CLI permissions",
  ],
  ["rate-limited", "gh: Too many requests (HTTP 429)", "Wait and refresh"],
] as const) {
  test(`${kind} refresh failures retain loaded content and explain the next action`, async ({
    page,
  }, testInfo) => {
    await page.goto("/?entry=detail&issueRepo=yu/Arco&number=42");
    const app = page.frameLocator("#arco");
    await expect(
      app.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const draft = app.getByRole("textbox", { name: "Comment on GitHub" });
    await draft.fill(
      "Keep this unsent comment while the source is unavailable.",
    );
    let reads = 0;
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      if (input.name !== "arco_get_issue") return route.continue();
      reads++;
      return route.fulfill({
        json: toolFailure(commandError(stderr).message, kind),
      });
    });
    await app.getByRole("button", { name: "Refresh", exact: true }).click();
    const error = app
      .getByRole("alert")
      .filter({ hasText: "Could not refresh this issue." });
    await expect(error).toContainText(guidance);
    await expect(error).not.toContainText("submitting this change again");
    await expect(
      app.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(draft).toHaveValue(
      "Keep this unsent comment while the source is unavailable.",
    );
    expect(reads).toBe(1);
    if (kind === "rate-limited") {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(error).toBeVisible();
      await error.scrollIntoViewIfNeeded();
      const overflows = await app.locator("body").evaluate((body) => {
        return body.scrollWidth > body.clientWidth;
      });
      expect(overflows).toBe(false);
      await page.screenshot({
        path: testInfo.outputPath("rate-limit-narrow.png"),
      });
    }
  });
}

test(
  "an unconfirmed comment keeps its draft and request ID and is not automatically posted again",
  { tag: "@smoke" },
  async ({ page }) => {
    await page.goto("/?entry=detail&issueRepo=yu/Arco&number=42");
    const app = page.frameLocator("#arco");
    await expect(
      app.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const draft = app.getByRole("textbox", { name: "Comment on GitHub" });
    const body = "Preserve this comment until the source result is confirmed.";
    await draft.fill(body);
    const requestIds: string[] = [];
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { requestId: string };
      };
      if (input.name !== "arco_comment") return route.continue();
      requestIds.push(input.arguments.requestId);
      return route.fulfill({
        json: toolFailure(
          "The source did not confirm this comment. Check the result in the source and refresh before submitting this change again.",
          "uncertain",
        ),
      });
    });
    await app.getByRole("button", { name: "Comment", exact: true }).click();
    const error = app
      .getByRole("alert")
      .filter({ hasText: "The source did not confirm this comment." });
    await expect(error).toContainText(
      "Check the result in the source and refresh before submitting this change again.",
    );
    await expect(draft).toHaveValue(body);
    expect(requestIds).toHaveLength(1);
    await app.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      app.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    expect(requestIds).toHaveLength(1);
    await app.getByRole("button", { name: "Comment", exact: true }).click();
    await expect.poll(() => requestIds.length).toBe(2);
    expect(requestIds[1]).toBe(requestIds[0]);
    await expect(draft).toHaveValue(body);
  },
);
