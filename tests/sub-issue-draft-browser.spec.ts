import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Draft, DraftKey, DraftRecord } from "../src/shared/state";
import { toolFailure } from "./tool-failure";

type ToolInput = {
  name: string;
  arguments: {
    key?: DraftKey;
    draft?: Draft;
    expectedRevision?: number;
    childRepo?: string;
    title?: string;
    body?: string;
  };
};
const isChildDraft = ({ arguments: { key } }: ToolInput) =>
  key?.source === "github" &&
  key.repo === "yu/Arco" &&
  key.issue === "child:42";
const savedChild: Draft = {
  title: "Saved child title",
  body: "Saved child description",
  comment: "",
  githubChildRepo: "other/Arco",
};
async function openChild(page: Page) {
  await page.goto("/?entry=detail&issueRepo=yu/Arco&number=42");
  const ui = page.frameLocator("#arco");
  await ui.getByText("More properties", { exact: true }).click();
  const relations = ui.locator(".relations-manager");
  await relations.locator("summary").first().click();
  await relations
    .getByRole("button", { name: "Create a sub-issue", exact: true })
    .click();
  return relations;
}
async function expectChild(relations: Locator, draft: Partial<Draft>) {
  await expect(
    relations.getByRole("textbox", { name: "Sub-issue title", exact: true }),
  ).toHaveValue(draft.title ?? "");
  await expect(
    relations.getByRole("textbox", { name: "Sub-issue body", exact: true }),
  ).toHaveValue(draft.body ?? "");
  await expect(
    relations.getByRole("textbox", {
      name: "Sub-issue repository",
      exact: true,
    }),
  ).toHaveValue(draft.githubChildRepo ?? "yu/Arco");
}

test("sub-issue edits survive a delayed initial draft read and save all current fields", async ({
  page,
}) => {
  await page.clock.install();
  let releaseRead!: () => void;
  const blocked = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let reading = false;
  const writes: ToolInput["arguments"][] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolInput;
    if (!isChildDraft(input)) return route.continue();
    if (input.name === "arco_read_draft") {
      reading = true;
      await blocked;
      return route.fulfill({
        json: { structuredContent: { revision: 7, draft: savedChild } },
      });
    }
    if (input.name === "arco_write_draft") {
      writes.push(input.arguments);
      return route.fulfill({
        json: {
          structuredContent: { revision: 8, draft: input.arguments.draft },
        },
      });
    }
    return route.continue();
  });
  const relations = await openChild(page);
  await expect.poll(() => reading).toBe(true);
  await relations
    .getByRole("textbox", { name: "Sub-issue title", exact: true })
    .fill("Typed while loading");
  await relations
    .getByRole("textbox", { name: "Sub-issue body", exact: true })
    .fill("The current description");
  await relations
    .getByRole("textbox", { name: "Sub-issue repository", exact: true })
    .fill("current/Arco");
  const current: Draft = {
    title: "Typed while loading",
    body: "The current description",
    comment: "",
    githubChildRepo: "current/Arco",
  };
  releaseRead();
  await page.clock.fastForward(1000);
  await expect.poll(() => writes.at(-1)?.draft).toEqual(current);
  expect(writes.at(-1)?.expectedRevision).toBe(7);
  await expectChild(relations, current);
});

test("retrying a failed sub-issue draft read restores every saved field without writing", async ({
  page,
}) => {
  await page.clock.install();
  let recovered = false;
  let reads = 0;
  const writes: string[] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolInput;
    if (!isChildDraft(input)) return route.continue();
    if (input.name === "arco_read_draft") {
      reads++;
      return route.fulfill({
        json: recovered
          ? { structuredContent: { revision: 7, draft: savedChild } }
          : toolFailure("Could not load the saved child draft.", "storage"),
      });
    }
    writes.push(input.name);
    return route.fulfill({ json: toolFailure("Unexpected draft write.") });
  });
  const relations = await openChild(page);
  await expect(relations.getByRole("alert")).toContainText(
    "Could not load the saved child draft.",
  );
  await expectChild(relations, {});
  recovered = true;
  await relations
    .getByRole("button", { name: "Retry loading draft", exact: true })
    .click();
  await expectChild(relations, savedChild);
  await expect(relations.getByRole("alert")).toHaveCount(0);
  await page.clock.fastForward(1000);
  expect(reads).toBe(2);
  expect(writes).toEqual([]);
});

test("using a saved sub-issue conflict updates all fields and successful creation clears the draft", async ({
  page,
}) => {
  await page.clock.install();
  let record: DraftRecord = { revision: 1, draft: null };
  const writes: string[] = [];
  const creations: ToolInput["arguments"][] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolInput;
    if (input.name === "arco_create_sub_issue") {
      creations.push(input.arguments);
      return route.fulfill({
        json: { structuredContent: { repo: "yu/Arco", number: 42 } },
      });
    }
    if (!isChildDraft(input)) return route.continue();
    if (input.name === "arco_read_draft")
      return route.fulfill({ json: { structuredContent: record } });
    writes.push(input.name);
    if (input.arguments.expectedRevision !== record.revision)
      return route.fulfill({
        json: toolFailure("Another view changed this draft.", "conflict"),
      });
    record = {
      revision: record.revision + 1,
      draft: input.name === "arco_delete_draft" ? null : input.arguments.draft!,
    };
    return route.fulfill({ json: { structuredContent: record } });
  });
  const relations = await openChild(page);
  await relations
    .getByRole("textbox", { name: "Sub-issue title", exact: true })
    .fill("Local child title");
  record = { revision: 2, draft: savedChild };
  await page.clock.fastForward(1000);
  await expect(relations.getByRole("alert")).toContainText(
    "This draft conflicts with another Arco view.",
  );
  await expect(
    relations.getByRole("textbox", { name: "Sub-issue title", exact: true }),
  ).toHaveValue("Local child title");
  await relations.getByText("Compare saved draft", { exact: true }).click();
  await relations
    .getByRole("button", { name: "Use saved draft", exact: true })
    .click();
  await expectChild(relations, savedChild);
  await expect(relations.getByRole("alert")).toHaveCount(0);
  expect(writes).toEqual(["arco_write_draft"]);
  expect(creations).toEqual([]);
  await relations
    .getByRole("button", { name: "Create sub-issue", exact: true })
    .click();
  await expect.poll(() => creations.length).toBe(1);
  expect(creations[0]).toMatchObject({
    childRepo: savedChild.githubChildRepo,
    title: savedChild.title,
    body: savedChild.body,
  });
  await expect.poll(() => record.draft).toBeNull();
  await expect(
    relations.getByRole("textbox", { name: "Sub-issue title", exact: true }),
  ).toHaveCount(0);
  await relations
    .getByRole("button", { name: "Create a sub-issue", exact: true })
    .click();
  await expectChild(relations, {});
  expect(writes).toEqual(["arco_write_draft", "arco_delete_draft"]);
});
