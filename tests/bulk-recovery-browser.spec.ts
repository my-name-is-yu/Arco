import { expect, test, type Page } from "./browser-test";
import type { BulkUpdateResult } from "../src/shared/github-operations";
import { choose } from "./select-helpers";
import { toolFailure } from "./tool-failure";

type ToolInput = {
  session: string;
  name: string;
  arguments: Record<string, unknown> & {
    issues?: { repo: string; number: number }[];
    number?: number;
  };
};
const app = (page: Page) => page.frameLocator("#arco");
const panel = (page: Page) =>
  app(page).getByRole("region", { name: "Bulk issue actions" });
const checkbox = (page: Page, number: number) =>
  app(page).getByRole("checkbox", {
    name: `Select yu/Arco #${number} for bulk actions`,
  });
async function select(page: Page, numbers = [42, 43]) {
  for (const number of numbers) await checkbox(page, number).check();
}
const apply = (page: Page) =>
  panel(page).getByRole("button", {
    name: "Apply",
    exact: true,
  });
const retry = (page: Page) =>
  panel(page).getByRole("button", {
    name: "Retry failed issues only",
    exact: true,
  });

test("changing a milestone after partial failure starts a new Apply for all selected issues", async ({
  page,
}) => {
  const calls: ToolInput["arguments"][] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolInput;
    if (input.name !== "arco_bulk_update") return route.continue();
    calls.push(input.arguments);
    if (calls.length !== 1) return route.continue();
    const response = await route.fetch({
      postData: JSON.stringify({
        ...input,
        arguments: {
          ...input.arguments,
          issues: input.arguments.issues!.slice(0, 1),
        },
      }),
    });
    const result = (await response.json()) as {
      structuredContent: BulkUpdateResult;
    };
    return route.fulfill({
      json: {
        content: [],
        structuredContent: {
          results: [
            ...result.structuredContent.results,
            {
              repo: "yu/Arco",
              number: 43,
              ok: false,
              error: "Permission denied before applying.",
              errorCode: "forbidden",
              needsConfirmation: false,
            },
          ],
        },
      },
    });
  });
  await page.goto("/?entry=project");
  await select(page);
  await choose(panel(page), "Bulk action", "milestone");
  await choose(panel(page), "Bulk attribute value", "1");
  await apply(page).click();
  await expect(retry(page)).toBeEnabled();
  await choose(panel(page), "Bulk attribute value", "2");
  await expect(retry(page)).toHaveCount(0);
  await expect(apply(page)).toBeEnabled();
  await apply(page).click();
  await expect(panel(page)).toHaveCount(0);
  expect(
    calls.map((call) => call.issues?.map((issue) => issue.number)),
  ).toEqual([
    [42, 43],
    [42, 43],
  ]);
  expect(calls[1].patch).toEqual({ milestoneNumber: 2 });
  expect(calls[1].requestId).not.toBe(calls[0].requestId);
});

for (const action of ["close", "assignee-add"] as const) {
  test(`${action} replays the exact request after an applied update loses its acknowledgement across a source switch`, async ({
    page,
  }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: ToolInput["arguments"][] = [];
    let applied = false;
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as ToolInput;
      if (input.name !== "arco_update_issue") return route.continue();
      calls.push(input.arguments);
      if (calls.length !== 1) return route.continue();
      await route.fetch();
      applied = true;
      await pending;
      return route.fulfill({
        json: toolFailure("The acknowledgement was lost."),
      });
    });
    try {
      await page.goto("/?entry=project&toolLimit=2");
      await select(page, [42]);
      await choose(panel(page), "Bulk action", action);
      if (action === "assignee-add")
        await choose(panel(page), "Bulk value", "fixture-reviewer");
      await apply(page).click();
      await expect.poll(() => applied).toBe(true);
      await choose(app(page), "Issue source", "linear");
      release();
      await choose(app(page), "Issue source", "github");
      await expect(retry(page)).toBeEnabled();
      await expect(apply(page)).toBeDisabled();
      await retry(page).click();
      await expect(panel(page)).toHaveCount(0);
      expect(calls).toHaveLength(2);
      expect(calls[1]).toEqual(calls[0]);
      await expect(page.locator("#harness-error")).toBeEmpty();
    } finally {
      release();
    }
  });
}

test("a request-level failed-only retry retains its targets and replays only that exact batch", async ({
  page,
}) => {
  const calls: ToolInput["arguments"][] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolInput;
    if (input.name !== "arco_bulk_update") return route.continue();
    calls.push(input.arguments);
    if (calls.length === 2)
      return route.fulfill({
        json: toolFailure("The retry result could not be confirmed."),
      });
    if (calls.length !== 1) return route.continue();
    const response = await route.fetch({
      postData: JSON.stringify({
        ...input,
        arguments: {
          ...input.arguments,
          issues: input.arguments.issues!.slice(0, 1),
        },
      }),
    });
    const result = (await response.json()) as {
      structuredContent: BulkUpdateResult;
    };
    return route.fulfill({
      json: {
        content: [],
        structuredContent: {
          results: [
            ...result.structuredContent.results,
            {
              repo: "yu/Arco",
              number: 43,
              ok: false,
              error: "Permission denied before applying.",
              errorCode: "forbidden",
              needsConfirmation: false,
            },
          ],
        },
      },
    });
  });
  await page.goto("/?entry=project");
  await select(page);
  await choose(panel(page), "Bulk action", "milestone");
  await choose(panel(page), "Bulk attribute value", "2");
  await apply(page).click();
  await retry(page).click();
  await expect(
    panel(page).getByRole("list", { name: "Failed issues", exact: true }),
  ).toContainText("#43");
  await expect(retry(page)).toBeEnabled();
  await expect(apply(page)).toBeDisabled();
  await retry(page).click();
  await expect(panel(page)).toHaveCount(0);
  expect(
    calls.map((call) => call.issues?.map((issue) => issue.number)),
  ).toEqual([[42, 43], [43], [43]]);
  expect(calls[2]).toEqual(calls[1]);
});

test("changing a draft cannot discard an unconfirmed update attempt", async ({
  page,
}) => {
  const calls: ToolInput["arguments"][] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolInput;
    if (input.name !== "arco_bulk_update") return route.continue();
    calls.push(input.arguments);
    if (calls.length === 1) {
      await route.fetch();
      return route.fulfill({
        json: toolFailure("The acknowledgement was lost."),
      });
    }
    return route.continue();
  });
  await page.goto("/?entry=project");
  await select(page);
  await choose(panel(page), "Bulk action", "milestone");
  await choose(panel(page), "Bulk attribute value", "1");
  await apply(page).click();
  await expect(retry(page)).toBeEnabled();
  await choose(panel(page), "Bulk attribute value", "2");
  await expect(apply(page)).toBeDisabled();
  await expect(
    panel(page).getByRole("list", { name: "Unconfirmed changes" }),
  ).toContainText("acknowledgement was lost");
  await panel(page)
    .getByRole("button", { name: "Retry unconfirmed changes", exact: true })
    .click();
  await expect(apply(page)).toBeEnabled();
  await expect(panel(page)).toBeVisible();
  expect(calls[1]).toEqual(calls[0]);
  await apply(page).click();
  await expect(panel(page)).toHaveCount(0);
  expect(calls[2].patch).toEqual({ milestoneNumber: 2 });
  expect(calls[2].requestId).not.toBe(calls[0].requestId);
});

test("bulk completion refreshes grouped issue tab state when returning inline", async ({
  page,
}) => {
  await page.goto("/?entry=issues");
  const tab = app(page).getByRole("tab", { name: /^yu\/Arco #42 / });
  await expect(tab).toHaveAccessibleDescription("Open");
  await app(page)
    .getByRole("button", { name: "Open details", exact: true })
    .click();
  await select(page, [42]);
  await apply(page).click();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(tab).toHaveAccessibleDescription("Closed · Completed");
  await expect(page.locator("#harness-error")).toBeEmpty();
});

for (const appliedBeforeFailure of [true, false]) {
  test(`read-only recovery confirms the current state when the original change was ${appliedBeforeFailure ? "applied" : "not received"}`, async ({
    page,
  }) => {
    const writes: ToolInput["arguments"][] = [];
    let failNextCheck = false;
    await page.route("**/tool", async (route) => {
      const input = route.request().postDataJSON() as ToolInput;
      if (input.name === "arco_get_issue" && failNextCheck) {
        failNextCheck = false;
        return route.fulfill({
          json: toolFailure("The read-only check is unavailable."),
        });
      }
      if (input.name !== "arco_change_labels") return route.continue();
      writes.push(input.arguments);
      if (writes.length !== 1) return route.continue();
      if (appliedBeforeFailure) await route.fetch();
      return route.fulfill({
        json: toolFailure("The update result is unconfirmed."),
      });
    });
    await page.goto("/?entry=project");
    await select(page, [43]);
    await choose(panel(page), "Bulk action", "label-add");
    await choose(panel(page), "Bulk value", "bug");
    await apply(page).click();
    await expect(retry(page)).toBeEnabled();
    await expect(apply(page)).toBeDisabled();
    const check = panel(page).getByRole("button", {
      name: "Check current state",
      exact: true,
    });
    // A failed read must retain the unknown attempt and must never submit a write.
    failNextCheck = true;
    await check.click();
    await expect(
      panel(page).getByRole("list", { name: "Unconfirmed changes" }),
    ).toContainText("Could not confirm");
    expect(writes).toHaveLength(1);
    await expect(apply(page)).toBeDisabled();
    await check.click();
    if (appliedBeforeFailure) {
      await expect(panel(page)).toHaveCount(0);
      expect(writes).toHaveLength(1);
    } else {
      await expect(
        panel(page).getByRole("list", { name: "Unconfirmed changes" }),
      ).toHaveCount(0);
      await expect(
        panel(page).getByRole("list", { name: "Failed issues", exact: true }),
      ).toContainText("The current state differs");
      await expect(retry(page)).toBeEnabled();
      expect(writes).toHaveLength(1);
      await retry(page).click();
      await expect(panel(page)).toHaveCount(0);
      expect(writes).toHaveLength(2);
      expect(writes[1].requestId).not.toBe(writes[0].requestId);
      expect(writes[1].add).toEqual(writes[0].add);
    }
    await expect(page.locator("#harness-error")).toBeEmpty();
  });
}

test("partial read-only recovery never replays the old batch across already reviewed targets", async ({
  page,
}) => {
  const writes: ToolInput["arguments"][] = [];
  let failRead43 = false;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolInput;
    if (
      input.name === "arco_get_issue" &&
      input.arguments.number === 43 &&
      failRead43
    ) {
      failRead43 = false;
      return route.fulfill({
        json: toolFailure("Issue43 is temporarily unavailable."),
      });
    }
    if (input.name !== "arco_bulk_update") return route.continue();
    writes.push(input.arguments);
    if (writes.length === 1)
      return route.fulfill({
        json: toolFailure("The batch acknowledgement is unconfirmed."),
      });
    return route.continue();
  });
  await page.goto("/?entry=project");
  await select(page);
  await choose(panel(page), "Bulk action", "milestone");
  await choose(panel(page), "Bulk attribute value", "2");
  await apply(page).click();
  await expect(retry(page)).toBeEnabled();
  failRead43 = true;
  const check = panel(page).getByRole("button", {
    name: "Check current state",
    exact: true,
  });
  await check.click();
  const unknown = panel(page).getByRole("list", {
    name: "Unconfirmed changes",
  });
  await expect(unknown).toContainText("#43");
  await expect(unknown).not.toContainText("#42");
  expect(writes).toHaveLength(1);
  await retry(page).click();
  await expect(retry(page)).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1].issues?.map((issue) => issue.number)).toEqual([42]);
  expect(writes[1].requestId).not.toBe(writes[0].requestId);
  await check.click();
  await expect(unknown).toHaveCount(0);
  await retry(page).click();
  await expect(panel(page)).toHaveCount(0);
  expect(writes[2].issues?.map((issue) => issue.number)).toEqual([43]);
  expect(writes[2].requestId).not.toBe(writes[0].requestId);
});

test("a late readback from retired authentication cannot release an unknown request ID", async ({
  page,
}) => {
  let generation = "readback-account-a";
  let holdRead = false;
  let held = false;
  let release = () => {};
  const writes: ToolInput["arguments"][] = [];
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as ToolInput;
    if (input.name === "arco_connection") {
      const response = await route.fetch();
      const result = await response.json();
      result.structuredContent.authGeneration = generation;
      return route.fulfill({ response, json: result });
    }
    if (input.name === "arco_change_labels") {
      writes.push(input.arguments);
      return route.fulfill({
        json: toolFailure("The update result is unconfirmed."),
      });
    }
    if (
      input.name !== "arco_get_issue" ||
      input.arguments.number !== 43 ||
      !holdRead
    )
      return route.continue();
    holdRead = false;
    const response = await route.fetch();
    held = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return route.fulfill({ response });
  });
  try {
    await page.goto("/?entry=project");
    await select(page, [43]);
    await choose(panel(page), "Bulk action", "label-add");
    await choose(panel(page), "Bulk value", "bug");
    await apply(page).click();
    await expect(retry(page)).toBeEnabled();
    holdRead = true;
    await panel(page)
      .getByRole("button", { name: "Check current state", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    generation = "readback-account-b";
    await app(page)
      .getByRole("button", { name: "Refresh", exact: true })
      .click();
    await expect(
      app(page)
        .locator('[data-arco-github-auth-generation="readback-account-b"]')
        .first(),
    ).toBeVisible();
    const completed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/tool") &&
        response.request().postDataJSON()?.name === "arco_get_issue" &&
        response.request().postDataJSON()?.arguments.number === 43,
    );
    release();
    await completed;
    await app(page)
      .locator("body")
      .evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    await select(page, [43]);
    await choose(panel(page), "Bulk action", "label-add");
    await choose(panel(page), "Bulk value", "bug");
    await apply(page).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1].requestId).toBe(writes[0].requestId);
  } finally {
    release();
  }
});
