import { expect, test, type Page } from "@playwright/test";
import { choose } from "./select-helpers";
import type { SettingsRecord } from "../src/shared/state";

const app = (page: Page) => page.frameLocator("#arco");
const titles = {
  github: "Preserve issue selection and scroll position",
  linear: "Keep Linear workflow states intact",
};
const commentLabel = { github: "Comment on GitHub", linear: "Linear comment" };
const postLabel = { github: "Post comment", linear: "Post comment to Linear" };
const githubReads = new Set([
  "arco_connection",
  "arco_repositories",
  "arco_list_issues",
  "arco_account_issues",
  "arco_get_issue",
  "arco_comments",
  "arco_repo_metadata",
  "arco_reactions",
  "arco_read_image",
]);
async function toolEvents(page: Page) {
  const events = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  ) as { type: string; value: { name: string } }[];
  return events
    .filter((event) => event.type === "tool")
    .map((event) => event.value.name);
}

test("only the visible source reads data and hidden updates refresh when it returns", async ({
  page,
}) => {
  const response = await page.request.post("/session");
  const { session } = (await response.json()) as { session: string };
  const settingsResponse = await page.request.post("/tool", {
    data: { session, name: "arco_get_settings", arguments: {} },
  });
  const current = (await settingsResponse.json())
    .structuredContent as SettingsRecord;
  await page.request.post("/tool", {
    data: {
      session,
      name: "arco_update_settings",
      arguments: {
        expectedRevision: current.revision,
        patch: { activeSource: "linear" },
      },
    },
  });
  await page.goto(`/?session=${session}&toolLimit=2`);
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  const ui = app(page);
  await expect(
    ui.getByRole("heading", { name: titles.linear, exact: true }),
  ).toBeVisible();
  expect(
    (await toolEvents(page)).filter((name) => githubReads.has(name)),
  ).toEqual([]);

  await choose(ui, "Issue source", "github");
  await expect(
    ui.getByRole("heading", { name: titles.github, exact: true }),
  ).toBeVisible();
  await ui
    .getByRole("textbox", { name: commentLabel.github, exact: true })
    .fill("GitHub session draft");
  await choose(ui, "Issue source", "linear");
  await expect(
    ui.getByRole("heading", { name: titles.linear, exact: true }),
  ).toBeVisible();
  await ui
    .getByRole("textbox", { name: commentLabel.linear, exact: true })
    .fill("Linear session draft");
  const before = (await toolEvents(page)).filter((name) =>
    githubReads.has(name),
  );
  const linearReads = (await toolEvents(page)).filter(
    (name) => name === "linear_get_issue",
  ).length;
  await page
    .getByRole("button", { name: "Mock external update #42", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await toolEvents(page)).filter((name) => name === "linear_get_issue")
          .length,
    )
    .toBeGreaterThan(linearReads);
  expect(
    (await toolEvents(page)).filter((name) => githubReads.has(name)),
  ).toEqual(before);
  await choose(ui, "Issue source", "github");
  await expect(
    ui.getByRole("heading", {
      name: "Issue updated by a Codex tool",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    ui.getByRole("textbox", { name: commentLabel.github, exact: true }),
  ).toHaveValue("GitHub session draft");
  await choose(ui, "Issue source", "linear");
  await expect(
    ui.getByRole("textbox", { name: commentLabel.linear, exact: true }),
  ).toHaveValue("Linear session draft");
  await expect(page.locator("#harness-error")).toBeEmpty();
});

for (const source of ["github", "linear"] as const) {
  test(`${source} writes keep their lock and complete in their original session across source switches`, async ({
    page,
  }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: Record<string, unknown>[] = [];
    const name = source === "github" ? "arco_comment" : "linear_comment";
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: Record<string, unknown>;
      };
      if (input.name === name) {
        requests.push(input.arguments);
        await pending;
      }
      await route.continue();
    });
    try {
      await page.goto("/?entry=project&toolLimit=2");
      await expect(page.locator("#bridge-status")).toHaveText("ready");
      const ui = app(page);
      if (source === "linear") await choose(ui, "Issue source", "linear");
      await expect(
        ui.getByRole("heading", { name: titles[source], exact: true }),
      ).toBeVisible();
      const comment = ui.getByRole("textbox", {
        name: commentLabel[source],
        exact: true,
      });
      const text = `Submitted ${source} comment across source switch`;
      await comment.fill(text);
      await ui
        .getByRole("button", { name: postLabel[source], exact: true })
        .click();
      await expect.poll(() => requests.length).toBe(1);
      const other = source === "github" ? "linear" : "github";
      await choose(ui, "Issue source", other);
      await expect(
        ui.getByRole("heading", { name: titles[other], exact: true }),
      ).toBeVisible();
      await ui
        .getByRole("textbox", { name: commentLabel[other], exact: true })
        .fill("Independent unsent comment");
      await choose(ui, "Issue source", source);
      await expect(comment).toHaveValue(text);
      await expect(
        ui.getByRole("button", { name: postLabel[source], exact: true }),
      ).toBeDisabled();
      release();
      await expect(comment).toHaveValue("");
      await expect(ui.getByText(text, { exact: true })).toBeVisible();
      expect(requests).toHaveLength(1);
      expect(requests[0].requestId).toEqual(expect.any(String));
      await choose(ui, "Issue source", other);
      await expect(
        ui.getByRole("textbox", { name: commentLabel[other], exact: true }),
      ).toHaveValue("Independent unsent comment");
      await expect(page.locator("#harness-error")).toBeEmpty();
    } finally {
      release();
    }
  });
}
