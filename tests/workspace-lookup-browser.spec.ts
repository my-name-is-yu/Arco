import { expect, test } from "./browser-test";
import type { RepositoryPage } from "../src/shared/contracts";
import type { SettingsRecord } from "../src/shared/state";
import { choose, selectControl } from "./select-helpers";

test("repository indexes retain first-page metadata, discovery order, and unknown saved repositories", async ({
  page,
}) => {
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { page?: number };
    };
    if (!["arco_get_settings", "arco_repositories"].includes(input.name))
      return route.fallback();
    const response = await route.fetch();
    if (input.name === "arco_get_settings") {
      const result = (await response.json()) as {
        structuredContent: SettingsRecord;
      };
      result.structuredContent.settings.githubRepos = [
        "unknown/saved",
        "yu/Arco",
      ];
      return route.fulfill({ response, json: result });
    }
    const repository = (
      repo: string,
      archived = false,
      issuesEnabled = true,
    ): RepositoryPage["repositories"][number] => ({
      id: repo,
      repo,
      url: `https://github.com/${repo}`,
      private: false,
      archived,
      issuesEnabled,
    });
    const second = input.arguments.page === 2;
    return route.fulfill({
      response,
      json: {
        structuredContent: {
          repositories: second
            ? [repository("yu/Arco", false, false), repository("yu/new")]
            : [
                repository("yu/Arco", true),
                repository("yu/locked", false, false),
              ],
          hasMore: !second,
          page: second ? 2 : 1,
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  const ui = page.frameLocator("#arco");
  await ui.getByText("Manage repositories", { exact: true }).click();
  await ui.getByRole("button", { name: "Load more repositories" }).click();
  await expect(
    ui.getByRole("button", { name: "Load more repositories" }),
  ).toHaveCount(0);
  await selectControl(ui, "GitHub view").getByRole("button").click();
  const menu = ui.getByRole("dialog");
  await expect(
    menu.getByRole("option", { name: "yu/Arco (archived)", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  await expect(
    menu.getByRole("option", {
      name: "yu/locked (issues disabled)",
      exact: true,
    }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    menu.getByRole("option", { name: "unknown/saved", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  expect(
    await menu
      .locator("[data-select-value]")
      .evaluateAll((items) =>
        items
          .map((item) => item.getAttribute("data-select-value"))
          .filter((value) => value?.includes("/")),
      ),
  ).toEqual(["unknown/saved", "yu/Arco", "yu/locked", "yu/new"]);
  await expect(page.locator("#harness-error")).toBeEmpty();
});

for (const source of ["github", "linear"] as const) {
  test(`${source} selection indexes retain filtered-out selections and their workflow restrictions`, async ({
    page,
  }) => {
    if (source === "linear")
      await page.route("**/tool", async (route) => {
        const input = route.request().postDataJSON() as { name: string };
        if (
          ![
            "linear_list_issues",
            "linear_get_issue",
            "linear_metadata",
          ].includes(input.name)
        )
          return route.fallback();
        const response = await route.fetch();
        const result = await response.json();
        const duplicate = {
          id: "linear-state-duplicate",
          name: "Duplicate",
          type: "duplicate",
          color: "#888888",
        };
        if (input.name === "linear_metadata")
          result.structuredContent.states.push(duplicate);
        else if (input.name === "linear_get_issue") {
          if (result.structuredContent.issueId === "fixture-linear-42")
            result.structuredContent.state = duplicate;
        } else {
          for (const issue of result.structuredContent.issues)
            if (issue.issueId === "fixture-linear-42") issue.state = duplicate;
        }
        return route.fulfill({ response, json: result });
      });
    await page.goto("/?entry=project");
    await expect(page.locator("#bridge-status")).toHaveText("ready");
    const ui = page.frameLocator("#arco");
    if (source === "linear") await choose(ui, "Issue source", "linear");
    const selected = ui.getByRole("checkbox", {
      name:
        source === "github"
          ? "Select yu/Arco #42 for bulk actions"
          : "YU-42 — select for bulk actions",
      exact: true,
    });
    await selected.check();
    const bulk = ui.getByRole("region", {
      name: source === "github" ? "Bulk issue actions" : "Bulk Linear actions",
    });
    await expect(bulk).toBeVisible();
    const search = ui.getByRole("textbox", {
      name: source === "github" ? "Search issues" : "Search Linear Issues",
      exact: true,
    });
    await search.fill(
      source === "github" ? "Separate shared context" : "Share a Linear issue",
    );
    await expect(selected).toHaveCount(0);
    await expect(bulk).toBeVisible();
    if (source === "linear") {
      await expect(bulk).toContainText(
        "Duplicate workflow states are managed through Linear’s merge flow.",
      );
      await expect(
        selectControl(bulk, "Bulk Linear workflow state").getByRole("button"),
      ).toBeDisabled();
    }
    await search.clear();
    await expect(selected).toBeChecked();
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}
