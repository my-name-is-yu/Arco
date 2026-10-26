import { expect, test, type Page } from "@playwright/test";
import type { measureSelectionAnnotation } from "../src/ui/SelectionAnnotation";

type Measurement = typeof measureSelectionAnnotation;

declare global {
  interface Window {
    annotationMeasurement: { measureSelectionAnnotation: Measurement };
  }
}

async function loadMeasurement(page: Page) {
  const { build } = await import("esbuild");
  const bundle = await build({
    stdin: {
      contents:
        "export { measureSelectionAnnotation } from './src/ui/SelectionAnnotation';",
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    globalName: "annotationMeasurement",
    platform: "browser",
    write: false,
    loader: { ".css": "empty", ".module.css": "empty" },
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}

test("actual annotation measurement rejects hidden and clipped ranges and retains a visible native rectangle", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`
    <span id="hidden" style="display:none">Selected text</span>
    <span id="zero" style="position:absolute;left:20px;top:20px;width:0;height:12px"></span>
    <span id="clipped" style="position:absolute;left:500px;top:20px">Selected text</span>
    <span id="visible" style="position:absolute;left:30px;top:40px">Selected text</span>
    <span id="mixed" style="position:absolute;left:30px;top:80px"><span style="display:inline-block;width:0;height:12px"></span><span>Selected text</span></span>
  `);
  await loadMeasurement(page);
  const measured = await page.evaluate(() => {
    return ["hidden", "zero", "clipped", "visible", "mixed"].map((id) => {
      const range = document.createRange();
      range[id === "zero" ? "selectNode" : "selectNodeContents"](
        document.getElementById(id)!,
      );
      const target = { range, sourceText: range.toString() };
      const measure = window.annotationMeasurement.measureSelectionAnnotation;
      const result = {
        id,
        native: range.getBoundingClientRect().toJSON(),
        rectangles: Array.from(range.getClientRects(), (rect) => rect.toJSON()),
        measured: measure(target, () => 0)?.rect.toJSON() ?? null,
        stale: measure(
          { ...target, sourceText: `${target.sourceText} changed` },
          () => 0,
        ),
      };
      document.getElementById(id)!.remove();
      return { ...result, detached: measure(target, () => 0) };
    });
  });
  expect(measured.slice(0, 3).map((item) => item.measured)).toEqual([
    null,
    null,
    null,
  ]);
  expect(measured[3].native.width).toBeGreaterThan(0);
  expect(measured[3].measured).toEqual(measured[3].native);
  expect(measured[1].rectangles[0]).toMatchObject({ width: 0, height: 12 });
  expect(measured[4].rectangles[0].width).toBe(0);
  expect(measured[4].measured).toEqual(
    measured[4].rectangles.find((rect) => rect.width > 0 && rect.height > 0),
  );
  expect(measured.map((item) => item.stale)).toEqual(Array(5).fill(null));
  expect(measured.map((item) => item.detached)).toEqual(Array(5).fill(null));
});

test("multiline measurement reads ancestor clips once and follows nested scrolling and viewport changes", async ({
  page,
}) => {
  await page.setContent(`
    <style>
      body { margin: 0 }
      #outer { position: absolute; left: 36px; top: 90px; width: 280px; height: 110px; overflow: auto; border: 5px solid }
      #inner { margin: 12px; width: 420px; height: 200px; overflow: auto; border: 3px solid }
      pre { margin: 0; width: 600px; line-height: 18px }
    </style>
    <div id="outer"><div id="inner"><div><div><div><div><pre id="source"></pre></div></div></div></div></div></div>
  `);
  await page.locator("#source").evaluate((element) => {
    element.textContent = Array.from(
      { length: 500 },
      (_, index) => `line ${index}: ${"selected text ".repeat(4)}`,
    ).join("\n");
  });
  await loadMeasurement(page);
  const results = [];
  for (const step of ["initial", "scroll", "resize"] as const) {
    await page.setViewportSize({
      width: step === "resize" ? 250 : 390,
      height: step === "resize" ? 210 : 844,
    });
    results.push(
      await page.evaluate((step) => {
        const outer = document.getElementById("outer")!;
        const inner = document.getElementById("inner")!;
        const source = document.getElementById("source")!;
        if (step === "scroll") {
          inner.scrollTop = 1807;
          inner.scrollLeft = 53;
          outer.scrollTop = 29;
          outer.scrollLeft = 17;
        }
        const range = document.createRange();
        range.selectNodeContents(source);
        const rectangles = Array.from(range.getClientRects());
        const limits = [outer, inner].map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left + element.clientLeft,
            right: rect.left + element.clientLeft + element.clientWidth,
            top: rect.top + element.clientTop,
            bottom: rect.top + element.clientTop + element.clientHeight,
          };
        });
        const clipped = rectangles.map((rect) => {
          const left = Math.max(0, rect.left, ...limits.map((x) => x.left));
          const right = Math.min(
            window.innerWidth,
            rect.right,
            ...limits.map((x) => x.right),
          );
          const top = Math.max(0, rect.top, ...limits.map((x) => x.top));
          const bottom = Math.min(
            window.innerHeight,
            rect.bottom,
            ...limits.map((x) => x.bottom),
          );
          return new DOMRect(
            left,
            top,
            Math.max(0, right - left),
            Math.max(0, bottom - top),
          );
        });
        const firstVisible = clipped.findIndex(
          (rect) => rect.width > 0 && rect.height > 0,
        );
        const expected = clipped[firstVisible];
        const ancestors = [];
        for (
          let element: Element | null = source;
          element;
          element = element.parentElement
        )
          ancestors.push(element);
        const style = window.getComputedStyle;
        const bounds = Element.prototype.getBoundingClientRect;
        const Rect = window.DOMRect;
        const calls = { style: 0, bounds: 0, rectangles: 0 };
        window.getComputedStyle = (...args) => {
          calls.style++;
          return style(...args);
        };
        Element.prototype.getBoundingClientRect = function () {
          calls.bounds++;
          return bounds.call(this);
        };
        window.DOMRect = class extends Rect {
          constructor(x = 0, y = 0, width = 0, height = 0) {
            super(x, y, width, height);
            calls.rectangles++;
          }
        };
        try {
          const layout =
            window.annotationMeasurement.measureSelectionAnnotation(
              { range, sourceText: range.toString() },
              () => 2,
            );
          return {
            expected: expected.toJSON(),
            rect: layout?.rect.toJSON(),
            badge: layout?.badge,
            editor: layout?.editor,
            calls,
            depth: ancestors.length,
            rectangles: rectangles.length,
            firstVisible,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
        } finally {
          window.getComputedStyle = style;
          Element.prototype.getBoundingClientRect = bounds;
          window.DOMRect = Rect;
        }
      }, step),
    );
  }
  for (const result of results) {
    expect(result.rectangles).toBeGreaterThan(500);
    expect(result.rect).toEqual(result.expected);
    expect(result.calls).toEqual({
      style: result.depth,
      bounds: result.depth,
      rectangles: result.firstVisible + 1,
    });
    expect(result.badge!.left).toBeGreaterThanOrEqual(8);
    expect(result.badge!.left).toBeLessThanOrEqual(result.viewport.width - 38);
    expect(result.editor!.top).toBeGreaterThanOrEqual(8);
    expect(result.editor!.top + 46).toBeLessThanOrEqual(
      result.viewport.height - 8,
    );
  }
  expect(results[1].rect).not.toEqual(results[0].rect);
  expect(results[2].rect!.right).toBeLessThan(results[1].rect!.right);
  expect(results[2].badge).not.toEqual(results[1].badge);
});

test("editable measurement keeps field styling and scroll positions and rejects stale targets", async ({
  page,
}) => {
  await page.setContent(`
    <style>
      #clip { position: absolute; left: 40px; top: 110px; width: 190px; height: 70px; overflow: hidden; border: 4px solid }
      textarea { width: 260px; height: 96px; font: 14px/20px monospace; padding: 7px; letter-spacing: 1px; tab-size: 3; border: 2px solid }
    </style>
    <div id="clip"><textarea wrap="off"></textarea></div>
  `);
  await loadMeasurement(page);
  for (const width of [390, 210]) {
    await page.setViewportSize({ width, height: 260 });
    const result = await page.evaluate(() => {
      const clip = document.getElementById("clip")!;
      const input = document.querySelector("textarea")!;
      input.value = Array.from({ length: 50 }, () =>
        "Selected text ".repeat(30),
      ).join("\n");
      input.scrollLeft = 90;
      input.scrollTop = 123;
      const target = {
        sourceText: "Selected",
        editable: { element: input, start: 0, end: 8, value: input.value },
      };
      const measure = window.annotationMeasurement.measureSelectionAnnotation;
      const bounds = input.getBoundingClientRect();
      const clipBounds = clip.getBoundingClientRect();
      const style = getComputedStyle(input);
      const layout = measure(target, () => 0)!;
      const expected = new DOMRect(
        bounds.left,
        bounds.top,
        Math.min(
          window.innerWidth,
          clipBounds.left + clip.clientLeft + clip.clientWidth,
          bounds.right,
        ) - bounds.left,
        Math.min(
          clipBounds.top + clip.clientTop + clip.clientHeight,
          bounds.bottom,
        ) - bounds.top,
      ).toJSON();
      input.value += "changed";
      const stale = measure(target, () => 0);
      input.value = target.editable.value;
      input.remove();
      const detached = measure(target, () => 0);
      clip.append(input);
      clip.hidden = true;
      const hidden = measure(target, () => 0);
      return {
        rect: layout.rect.toJSON(),
        expected,
        field: {
          rect: layout.field!.rect.toJSON(),
          scrollLeft: layout.field!.scrollLeft,
          scrollTop: layout.field!.scrollTop,
          style: layout.field!.style,
        },
        native: bounds.toJSON(),
        style: {
          font: style.font,
          padding: style.padding,
          letterSpacing: style.letterSpacing,
          tabSize: style.tabSize,
        },
        stale,
        detached,
        hiddenRect: hidden?.rect.toJSON(),
      };
    });
    expect(result.rect).toEqual(result.expected);
    expect(result.field.rect).toEqual(result.native);
    expect(result.field).toMatchObject({ scrollLeft: 90, scrollTop: 123 });
    expect(result.field.style).toMatchObject({
      ...result.style,
      whiteSpace: "pre-wrap",
      borderStyle: "solid",
    });
    expect(result.stale).toBeNull();
    expect(result.detached).toBeNull();
    expect(result.hiddenRect).toMatchObject({ width: 0, height: 0 });
    await page.locator("#clip").evaluate((element) => {
      element.removeAttribute("hidden");
    });
  }
});
