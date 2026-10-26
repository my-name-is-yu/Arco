import { expect, test } from "./browser-test";
import type { Draft, DraftKey } from "../src/shared/state";
import { toolFailure } from "./tool-failure";

for (const source of ["github", "linear"] as const) {
  test(`${source} creation draft attributes survive save retry and conflict resolution`, async ({
    page,
  }) => {
    await page.clock.install();
    const attributes =
      source === "github"
        ? {
            githubLabels: ["bug"],
            githubAssignees: ["yu"],
            githubIssueTypeName: "Bug",
          }
        : {
            linearTemplateId: "linear-simple-template",
            linearDescriptionTouched: true,
          };
    let saved: Draft = {
      title: "Saved creation draft",
      body: "Retained body",
      comment: "",
      ...attributes,
    };
    let revision = 2;
    let fail = true;
    const writes: Draft[] = [];
    const creates: string[] = [];
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as {
        name: string;
        arguments: { key?: DraftKey; expectedRevision?: number; draft: Draft };
      };
      if (["arco_create_issue", "linear_create_issue"].includes(input.name)) {
        creates.push(input.name);
        return route.fulfill({
          json: toolFailure("Unexpected issue creation"),
        });
      }
      if (
        input.arguments.key?.source !== source ||
        input.arguments.key.issue !== "new"
      )
        return route.continue();
      if (input.name === "arco_read_draft")
        return route.fulfill({
          json: { structuredContent: { revision, draft: saved } },
        });
      if (input.name !== "arco_write_draft") return route.continue();
      writes.push(input.arguments.draft);
      if (fail)
        return route.fulfill({
          json: toolFailure("Draft storage unavailable", "storage"),
        });
      if (input.arguments.expectedRevision !== revision)
        return route.fulfill({
          json: toolFailure("The saved draft changed", "conflict"),
        });
      saved = input.arguments.draft;
      revision++;
      return route.fulfill({
        json: { structuredContent: { revision, draft: saved } },
      });
    });

    await page.goto(
      source === "github" ? "/?entry=project" : "/?source=linear",
    );
    const ui = page.frameLocator("#arco");
    const name = source === "github" ? "Create issue" : "Create Linear Issue";
    await ui.getByRole("button", { name, exact: true }).click();
    const dialog = ui.getByRole("dialog", { name, exact: true });
    const title = dialog.getByRole("textbox", { name: "Title", exact: true });
    await expect(title).toHaveValue("Saved creation draft");
    await title.fill("Edited creation draft");
    await page.clock.fastForward(300);
    await expect(dialog.getByRole("alert")).toContainText(
      "Draft storage unavailable",
    );
    fail = false;
    await dialog.getByRole("button", { name: "Retry saving draft" }).click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    expect(saved).toEqual({
      title: "Edited creation draft",
      body: "Retained body",
      comment: "",
      ...attributes,
    });
    expect(writes).toEqual([saved, saved]);
    expect(creates).toEqual([]);

    saved = { ...saved, title: "Changed in another view" };
    revision++;
    await dialog
      .getByRole("textbox", {
        name: source === "github" ? "Body" : "Markdown description",
        exact: true,
      })
      .fill("Local body after conflict");
    await page.clock.fastForward(300);
    await expect(dialog.getByRole("alert")).toContainText(
      "This draft conflicts with another Arco view",
    );
    await dialog.getByText("Compare saved draft", { exact: true }).click();
    await dialog
      .getByRole("button", { name: "Save this screen’s draft", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    expect(saved).toEqual({
      title: "Edited creation draft",
      body: "Local body after conflict",
      comment: "",
      ...attributes,
    });
    expect(writes.slice(2)).toEqual([saved, saved]);
    expect(creates).toEqual([]);
  });
}
