import { expect, test } from "@playwright/test";
import type { Draft, DraftKey } from "../src/shared/state";
import { toolFailure } from "./tool-failure";

const loadFailure =
  "Your saved draft could not be opened. It has been kept unchanged.";

test("a GitHub comment edit reloads its saved text after a read failure without saving the default text", async ({
  page,
}) => {
  await page.clock.install();
  let recovered = false;
  let reads = 0;
  const writes: string[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { key?: DraftKey };
    };
    if (["arco_write_draft", "arco_edit_comment"].includes(input.name)) {
      writes.push(input.name);
      return route.fulfill({ json: toolFailure("Unexpected write.") });
    }
    const key = input.arguments.key;
    if (
      input.name === "arco_read_draft" &&
      key?.source === "github" &&
      key.repo === "yu/Arco" &&
      key.issue.startsWith("42:comment:")
    ) {
      reads++;
      return route.fulfill({
        json: recovered
          ? {
              structuredContent: {
                revision: 7,
                draft: {
                  title: "",
                  body: "",
                  comment: "Recovered unsent GitHub comment edit",
                },
              },
            }
          : toolFailure(loadFailure, "storage"),
      });
    }
    return route.continue();
  });
  await page.goto("/?entry=detail&issueRepo=yu/Arco&number=42");
  const ui = page.frameLocator("#arco");
  const comment = ui.locator(".comment").first();
  await comment.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = comment.getByRole("textbox", {
    name: "Edit comment",
    exact: true,
  });
  await expect(comment.getByRole("alert")).toContainText(loadFailure);
  await expect(editor).not.toHaveValue("Recovered unsent GitHub comment edit");
  recovered = true;
  await comment
    .getByRole("button", { name: "Retry loading draft", exact: true })
    .click();
  await expect(editor).toHaveValue("Recovered unsent GitHub comment edit");
  await expect(comment.getByRole("alert")).toHaveCount(0);
  await page.clock.fastForward(1000);
  expect(reads).toBe(2);
  expect(writes).toEqual([]);
});

test("Linear retries draft loading and restores its editor and unsent comment without a write", async ({
  page,
}) => {
  await page.clock.install();
  let recovered = false;
  let reads = 0;
  let saved: Draft | undefined;
  const writes: string[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { key?: DraftKey; issueId?: string };
    };
    if (
      ["arco_write_draft", "linear_update_issue", "linear_comment"].includes(
        input.name,
      )
    ) {
      writes.push(input.name);
      return route.fulfill({ json: toolFailure("Unexpected write.") });
    }
    if (
      input.name === "linear_get_issue" &&
      input.arguments.issueId === "fixture-linear-42"
    ) {
      const response = await route.fetch();
      const result = await response.json();
      const issue = result.structuredContent;
      saved = {
        title: "Recovered Linear title",
        body: "Recovered unsaved Linear description",
        comment: "Recovered unsent Linear comment",
        baseTitle: issue.title,
        baseBody: issue.body,
        baseUpdatedAt: issue.updatedAt,
      };
      return route.fulfill({ response, json: result });
    }
    const key = input.arguments.key;
    if (
      input.name === "arco_read_draft" &&
      key?.source === "linear" &&
      key.issue === "fixture-linear-42"
    ) {
      reads++;
      return route.fulfill({
        json: recovered
          ? { structuredContent: { revision: 7, draft: saved } }
          : toolFailure(loadFailure, "storage"),
      });
    }
    return route.continue();
  });
  await page.goto("/?entry=detail&source=linear&number=42");
  const ui = page.frameLocator("#arco");
  await expect(ui.getByRole("alert")).toContainText(loadFailure);
  await expect(
    ui.getByRole("textbox", { name: "Linear title", exact: true }),
  ).toHaveCount(0);
  recovered = true;
  await ui
    .getByRole("button", { name: "Retry loading draft", exact: true })
    .click();
  await expect(
    ui.getByRole("textbox", { name: "Linear title", exact: true }),
  ).toHaveValue("Recovered Linear title");
  await expect(
    ui.getByRole("textbox", {
      name: "Linear Markdown description",
      exact: true,
    }),
  ).toHaveValue("Recovered unsaved Linear description");
  await expect(
    ui.getByRole("textbox", { name: "Linear comment", exact: true }),
  ).toHaveValue("Recovered unsent Linear comment");
  await expect(ui.getByRole("alert")).toHaveCount(0);
  await page.clock.fastForward(1000);
  expect(reads).toBe(2);
  expect(writes).toEqual([]);
});
