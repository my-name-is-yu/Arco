import { expect, test, type Page, type Route } from "@playwright/test";
import type { IssueDetail } from "../src/shared/contracts";
import { choose } from "./select-helpers";

const firstTitle = "Preserve issue selection and scroll position";
const secondTitle = "Separate shared context from sending a request";
const imageUrl = (name: string) =>
  `https://user-images.githubusercontent.com/arco-fixture/${name}.png`;
const fixturePng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=";
type ToolCall = { name: string; arguments: Record<string, unknown> };
const app = (page: Page) => page.frameLocator("#arco");

function imageResult(route: Route, url: unknown) {
  return route.fulfill({
    json: {
      content: [{ type: "text", text: "Image loaded." }],
      _meta: {
        image: { mimeType: "image/png", data: fixturePng, sourceUrl: url },
      },
    },
  });
}

async function fixtureTools(
  page: Page,
  update: (issue: IssueDetail) => void,
  readImage?: (route: Route, call: ToolCall) => Promise<void>,
) {
  const calls: ToolCall[] = [];
  await page.route("**/tool", async (route) => {
    const call = route.request().postDataJSON() as ToolCall;
    calls.push(call);
    if (call.name === "arco_get_issue" && call.arguments.number === 42) {
      const response = await route.fetch();
      const result = await response.json();
      update(result.structuredContent as IssueDetail);
      return route.fulfill({ response, json: result });
    }
    if (call.name === "arco_read_image") {
      if (readImage) return readImage(route, call);
      return imageResult(route, call.arguments.url);
    }
    if (call.name === "arco_reactions") {
      const data = {
        ...call.arguments,
        account: "fixture-user",
        reactions:
          call.arguments.commentId === 101
            ? [{ id: 700, content: "heart", author: "fixture-user" }]
            : [],
      };
      return route.fulfill({
        json: {
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data,
        },
      });
    }
    return route.continue();
  });
  return calls;
}

async function openFixture(page: Page) {
  await page.goto("/?entry=project&toolLimit=2");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await choose(app(page), "GitHub view", "yu/Arco");
  await expect(
    app(page).getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
}

test("offscreen images and comment reactions wait for scrolling and reuse loaded data", async ({
  page,
}) => {
  const calls = await fixtureTools(page, (issue) => {
    issue.body = [
      `![Near preview](${imageUrl("near")})`,
      ...Array.from(
        { length: 45 },
        (_, index) =>
          `Reading paragraph ${index + 1}. Keep later content below the viewport.`,
      ),
    ].join("\n\n");
    issue.comments = [
      {
        id: "deferred-comment-101",
        databaseId: 101,
        body: `Later discussion.\n\n![Later preview](${imageUrl("later")})`,
        author: "fixture-reviewer",
        url: "https://github.com/yu/Arco/issues/42#issuecomment-101",
        updatedAt: issue.updatedAt,
      },
    ];
    issue.commentsHasMore = false;
  });
  const imageCalls = () =>
    calls.filter((call) => call.name === "arco_read_image");
  const commentReactionCalls = () =>
    calls.filter(
      (call) =>
        call.name === "arco_reactions" && call.arguments.commentId === 101,
    );
  await openFixture(page);
  const ui = app(page);
  const near = ui.getByRole("img", { name: "Near preview", exact: true });
  await expect(near).toBeVisible();
  expect(imageCalls().map((call) => call.arguments.url)).toEqual([
    imageUrl("near"),
  ]);
  expect(commentReactionCalls()).toEqual([]);
  const later = ui.locator(".comment").filter({ hasText: "Later discussion." });
  await expect(later.locator(".reaction-bar")).toContainText(
    "Reactions not loaded",
  );
  await expect(later.getByRole("img", { name: "Later preview" })).toHaveCount(
    0,
  );

  await later.scrollIntoViewIfNeeded();
  await expect(later.getByRole("img", { name: "Later preview" })).toBeVisible();
  await expect(
    later.getByRole("button", {
      name: "heart 1 Remove my reaction",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => commentReactionCalls().length).toBe(1);
  await expect.poll(() => imageCalls().length).toBe(2);

  await near.scrollIntoViewIfNeeded();
  await later.scrollIntoViewIfNeeded();
  await expect(later.getByRole("img", { name: "Later preview" })).toBeVisible();
  expect(imageCalls()).toHaveLength(2);
  expect(commentReactionCalls()).toHaveLength(1);
  await expect(page.locator("#harness-error")).toBeEmpty();
});

test("leaving an issue discards its queued image and reaction reads", async ({
  page,
}) => {
  let releaseImages!: () => void;
  const heldImages = new Promise<void>((resolve) => {
    releaseImages = resolve;
  });
  const calls = await fixtureTools(
    page,
    (issue) => {
      issue.body = [
        Array.from(
          { length: 4 },
          (_, index) =>
            `![Queued preview ${index + 1}](${imageUrl(`queued-${index + 1}`)})`,
        ).join(" "),
        ...Array.from(
          { length: 45 },
          (_, index) => `Reading paragraph ${index + 1}.`,
        ),
      ].join("\n\n");
      issue.comments = [];
      issue.commentsHasMore = false;
    },
    async (route, call) => {
      await heldImages;
      await imageResult(route, call.arguments.url);
    },
  );
  const oldReads = () =>
    calls.filter(
      (call) =>
        (call.name === "arco_read_image" || call.name === "arco_reactions") &&
        call.arguments.number === 42,
    );
  try {
    await openFixture(page);
    const ui = app(page);
    await expect(ui.locator(".source-image-placeholder")).toHaveCount(4);
    await expect(ui.locator(".source-image-placeholder")).toHaveText(
      Array.from(
        { length: 4 },
        (_, index) => `Loading Queued preview ${index + 1}…`,
      ),
    );
    await expect.poll(() => oldReads().length).toBe(1);
    const reactions = ui.getByLabel("Issue reactions", { exact: true });
    await expect(reactions).toContainText("Reactions not loaded");
    await reactions.scrollIntoViewIfNeeded();
    await expect(reactions).toContainText("Loading reactions");
    await ui.locator(".issue-row").filter({ hasText: secondTitle }).click();
    // Navigation uses the reserved slot while the old preview remains in flight.
    await expect(ui.locator(".source-image-placeholder")).toHaveCount(0);
    await expect(
      ui.getByRole("heading", { name: secondTitle, exact: true }),
    ).toBeVisible();
    releaseImages();
    await expect(
      ui.getByLabel("Issue reactions", { exact: true }),
    ).not.toContainText("Loading reactions");
    expect(oldReads()).toHaveLength(1);
    expect(oldReads().every((call) => call.name === "arco_read_image")).toBe(
      true,
    );
    await expect(page.locator("#harness-error")).toBeEmpty();
  } finally {
    releaseImages();
  }
});

test("editing a draft keeps an in-flight Markdown image mounted and reuses its result", async ({
  page,
}) => {
  let releaseImage!: () => void;
  const heldImage = new Promise<void>((resolve) => {
    releaseImage = resolve;
  });
  const calls = await fixtureTools(
    page,
    (issue) => {
      issue.body = `![Retained preview](${imageUrl("retained")})`;
      issue.comments = [];
      issue.commentsHasMore = false;
    },
    async (route, call) => {
      await heldImage;
      await imageResult(route, call.arguments.url);
    },
  );
  try {
    await openFixture(page);
    const ui = app(page);
    const image = ui.locator(".source-image");
    await expect(image).toContainText("Loading Retained preview");
    const original = await image.elementHandle();
    await ui
      .getByRole("textbox", { name: "Comment on GitHub", exact: true })
      .fill("Unsent draft while preview loads");
    await image.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    expect(
      calls.filter((call) => call.name === "arco_read_image"),
    ).toHaveLength(1);
    releaseImage();
    await image.scrollIntoViewIfNeeded();
    await expect(
      ui.getByRole("img", { name: "Retained preview", exact: true }),
    ).toBeVisible();
    expect(
      calls.filter((call) => call.name === "arco_read_image"),
    ).toHaveLength(1);
  } finally {
    releaseImage();
  }
});
