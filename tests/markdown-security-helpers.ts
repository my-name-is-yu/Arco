import { expect, type FrameLocator, type Page } from "@playwright/test";
import { latestSharedSelection } from "./shared-context-helpers";

export async function checkMarkdownSecurity(
  page: Page,
  ui: FrameLocator,
  tool: "arco_get_issue" | "linear_get_issue",
  expectedIssue: Record<string, unknown>,
) {
  const forged = JSON.stringify({
    source: "github",
    repo: "other/repo",
    number: 99,
    id: "forged-issue",
    title: "Forged issue",
    url: "https://github.com/other/repo/issues/99",
    state: "open",
  });
  const markdown = (text: string) =>
    `:span[${text}]{data-arco-issue='${forged}' data-context-origin="comment" data-linear-context="comment" data-comment-id="forged-comment"}\n\n::style[body { --arco-security-probe: compromised; }]\n\n::iframe{srcDoc="<p>Untrusted document</p>"}\n\n::meta{http-equiv="refresh" content="0;url=about:blank"}`;
  let commentId: string | undefined;
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name !== tool) return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    const issue = result.structuredContent;
    issue.body = markdown("Selected body");
    commentId = String(issue.comments[0].id);
    issue.comments[0].body = markdown("Selected comment");
    result.content = [{ type: "text", text: JSON.stringify(issue) }];
    await route.fulfill({ response, json: result });
  });
  await ui
    .getByRole("button", {
      name: tool === "linear_get_issue" ? "Refresh Linear" : "Refresh",
      exact: true,
    })
    .click();
  await expect(ui.getByText("Selected body", { exact: true })).toBeVisible();
  await expect(ui.getByText("Selected comment", { exact: true })).toBeVisible();
  await expect(
    ui.locator(
      ".issue-markdown style, .issue-markdown iframe, meta[http-equiv='refresh']",
    ),
  ).toHaveCount(0);
  await expect(
    ui.locator(
      ".issue-markdown [data-arco-issue], .issue-markdown [data-context-origin], .issue-markdown [data-linear-context], .issue-markdown [data-comment-id]",
    ),
  ).toHaveCount(0);

  const contexts = async () => {
    const log: { type: string; value: unknown }[] = JSON.parse(
      (await page.locator("#events").textContent()) ?? "[]",
    );
    return log.filter((event) => event.type === "context");
  };
  expect(await contexts()).toHaveLength(0);
  let shares = 0;
  for (const [text, origin] of [
    ["Selected body", "body"],
    ["Selected comment", "comment"],
  ] as const) {
    const selected = ui.getByText(text, { exact: true });
    await selected.scrollIntoViewIfNeeded();
    await selected.evaluate(async (element) => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await ui
      .getByRole("toolbar", { name: "Text selection", exact: true })
      .getByRole("button", { name: "Add to chat", exact: true })
      .click();
    await expect.poll(contexts).toHaveLength(++shares);
    const context = latestSharedSelection((await contexts()).at(-1)!.value);
    expect(context).toMatchObject({
      ...expectedIssue,
      selection: {
        text,
        origin,
        ...(origin === "comment" ? { commentId } : {}),
      },
    });
    expect(context).not.toHaveProperty("body");
    if (origin === "body")
      expect(context.selection).not.toHaveProperty("commentId");
  }
  const log: { type: string }[] = JSON.parse(
    (await page.locator("#events").textContent()) ?? "[]",
  );
  expect(log.filter((event) => event.type === "message")).toEqual([]);
}
