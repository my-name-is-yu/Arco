import { expect, test, type FrameLocator } from "./browser-test";
import { choose } from "./select-helpers";

type SelectionProbe = {
  observers: number;
  toggleListeners: number;
  rectReads: number;
  measuring: boolean;
};

declare global {
  interface Window {
    arcoSelectionProbe: SelectionProbe;
  }
}

const toolbar = (app: FrameLocator) =>
  app.getByRole("toolbar", { name: "Text selection", exact: true });
const editor = (app: FrameLocator) =>
  app.getByRole("dialog", { name: "Selection comment", exact: true });

async function annotate(app: FrameLocator, selector: string) {
  const target = app.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(async (element) => {
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
  await toolbar(app).getByRole("button", { name: "Add to chat" }).click();
  await expect(editor(app)).toBeVisible();
  await editor(app).press("Escape");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const probe: SelectionProbe = {
      observers: 0,
      toggleListeners: 0,
      rectReads: 0,
      measuring: false,
    };
    Object.assign(window, { arcoSelectionProbe: probe });
    const NativeObserver = MutationObserver;
    window.MutationObserver = class extends NativeObserver {
      private selectionObserver = false;
      override observe(target: Node, options?: MutationObserverInit) {
        if (
          target === document.body &&
          options?.attributeFilter?.includes("data-arco-issue") &&
          !this.selectionObserver
        ) {
          this.selectionObserver = true;
          probe.observers += 1;
        }
        super.observe(target, options);
      }
      override disconnect() {
        if (this.selectionObserver) {
          probe.observers -= 1;
          this.selectionObserver = false;
        }
        super.disconnect();
      }
    };
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const toggles = new Set<EventListenerOrEventListenerObject>();
    EventTarget.prototype.addEventListener = function (
      type,
      callback,
      options,
    ) {
      if (this === document && type === "toggle" && callback) {
        toggles.add(callback);
        probe.toggleListeners = toggles.size;
      }
      add.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (
      type,
      callback,
      options,
    ) {
      if (this === document && type === "toggle" && callback) {
        toggles.delete(callback);
        probe.toggleListeners = toggles.size;
      }
      remove.call(this, type, callback, options);
    };
    const rects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () {
      if (probe.measuring) probe.rectReads += 1;
      return rects.call(this);
    };
  });
  await page.goto("/?entry=project");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await choose(page.frameLocator("#arco"), "GitHub view", "yu/Arco");
  await expect(
    page.frameLocator("#arco").getByRole("heading", {
      name: "Preserve issue selection and scroll position",
      exact: true,
    }),
  ).toBeVisible();
});

test("annotation count does not add document observers or listeners and scroll bursts share one measurement frame", async ({
  page,
}) => {
  const app = page.frameLocator("#arco");
  for (let number = 1; number <= 3; number += 1) {
    await annotate(app, ".issue-heading h1");
    await expect(app.locator(".selection-annotation-number")).toHaveCount(
      number,
    );
  }
  const measured = await app.locator("body").evaluate(async () => {
    const probe = window.arcoSelectionProbe;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    probe.rectReads = 0;
    probe.measuring = true;
    for (let index = 0; index < 25; index += 1)
      document.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    probe.measuring = false;
    return { ...probe };
  });
  expect(measured.observers).toBe(1);
  expect(measured.toggleListeners).toBe(1);
  expect(measured.rectReads).toBeGreaterThanOrEqual(3);
  expect(measured.rectReads).toBeLessThanOrEqual(6);
  const bounds = await app
    .locator(".selection-annotation-number")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top),
    );
  expect(new Set(bounds).size).toBe(3);
});

test("hidden and refreshed targets restore, while a changed comment identity cannot inherit an annotation", async ({
  page,
}) => {
  const app = page.frameLocator("#arco");
  const comment = app.locator('[data-context-origin="comment"]').first();
  const identity = await comment.getAttribute("data-comment-id");
  expect(identity).toBeTruthy();
  await annotate(app, '[data-context-origin="comment"] p');
  const marker = app.getByRole("button", { name: "Edit selection comment 1" });
  await expect(marker).toBeVisible();
  await comment.evaluate((element) => {
    element.setAttribute("hidden", "");
  });
  await expect(marker).toBeHidden();
  await comment.evaluate((element) => element.removeAttribute("hidden"));
  await expect(marker).toBeVisible();
  await comment.evaluate((element) => {
    element.replaceChildren(
      ...Array.from(element.childNodes, (node) => node.cloneNode(true)),
    );
  });
  await expect(marker).toBeVisible();
  await comment.evaluate((element) =>
    element.setAttribute("data-comment-id", "replacement-comment"),
  );
  await expect(marker).toHaveCount(0);
  await comment.evaluate(
    (element, original) => element.setAttribute("data-comment-id", original!),
    identity,
  );
  await expect(marker).toBeVisible();
  const contextEvents = await page
    .locator("#events")
    .evaluate(
      (element) =>
        (JSON.parse(element.textContent ?? "[]") as { type: string }[]).filter(
          (event) => event.type === "context",
        ).length,
    );
  expect(contextEvents).toBe(1);
});
