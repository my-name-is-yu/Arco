import { toolFailure } from "./tool-failure";
import { expect, test } from "@playwright/test";
import { choose, selectControl } from "./select-helpers";
import type { SettingsRecord } from "../src/shared/state";

for (const savedTeam of [null, "removed-team"]) {
  test(`Linear requires a team choice when the saved team is ${savedTeam ?? "unset"}`, async ({
    page,
  }) => {
    let seeded = false;
    let session = "";
    const reads: string[] = [];
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        session: string;
        name: string;
      };
      session = input.session;
      if (input.name === "arco_get_settings" && !seeded) {
        seeded = true;
        const response = await route.fetch();
        const current = (await response.json())
          .structuredContent as SettingsRecord;
        const updated = await page.request.post("/tool", {
          data: {
            session,
            name: "arco_update_settings",
            arguments: {
              expectedRevision: current.revision,
              patch: { activeLinearTeam: savedTeam },
            },
          },
        });
        return route.fulfill({ json: await updated.json() });
      }
      if (
        ["linear_list_issues", "linear_get_issue", "linear_metadata"].includes(
          input.name,
        )
      )
        reads.push(input.name);
      return route.continue();
    });
    await page.goto("/");
    const app = page.frameLocator("#arco");
    await expect(page.locator("#bridge-status")).toHaveText("ready");
    await choose(app, "Issue source", "linear");
    await expect(selectControl(app, "Linear Team")).toHaveAttribute(
      "data-value",
      "",
    );
    await expect(
      app.getByText(
        savedTeam
          ? "The selected Linear team is unavailable. Choose a team to continue."
          : "Choose a Linear team to load its issues.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(reads).toEqual([]);
    await choose(app, "Linear Team", "fixture-linear-team");
    await expect(app.locator(".issue-row").first()).toBeVisible();
    await expect
      .poll(async () => {
        const result = await page.request.post("/tool", {
          data: { session, name: "arco_get_settings", arguments: {} },
        });
        return ((await result.json()).structuredContent as SettingsRecord)
          .settings.activeLinearTeam;
      })
      .toBe("fixture-linear-team");
    expect(reads).toContain("linear_list_issues");
  });
}

for (const teamDiscovery of ["failed", "empty"]) {
  test(`an explicit Linear issue remains readable when team discovery is ${teamDiscovery}`, async ({
    page,
  }) => {
    const listReads: string[] = [];
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as { name: string };
      if (input.name === "linear_list_issues") listReads.push(input.name);
      if (input.name !== "linear_scopes") return route.continue();
      if (teamDiscovery === "failed")
        return route.fulfill({
          json: toolFailure("Team discovery is unavailable."),
        });
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.teams = [];
      return route.fulfill({ response, json: result });
    });
    await page.goto("/?entry=detail&source=linear&number=43");
    const app = page.frameLocator("#arco");
    await expect(page.locator("#bridge-status")).toHaveText("ready");
    await expect(
      app.getByRole("heading", {
        name: "Share a Linear issue with the Codex chat",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      app.getByText(
        teamDiscovery === "failed"
          ? "Could not load Linear teams"
          : "No Linear teams available",
        { exact: true },
      ),
    ).toBeVisible();
    expect(listReads).toEqual([]);
  });
}
