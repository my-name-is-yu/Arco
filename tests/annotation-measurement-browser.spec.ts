import { expect, test } from "@playwright/test";
import type { measureSelectionAnnotation } from "../src/ui/SelectionAnnotation";

type Measurement = typeof measureSelectionAnnotation;

test("actual annotation measurement rejects hidden and clipped ranges and retains a visible native rectangle", async ({
  page,
}) => {
  const { build } = await import("esbuild");
  const bundle = await build({
    stdin: {
      contents:
        "export { measureSelectionAnnotation } from './src/ui/SelectionAnnotation';",
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    loader: { ".css": "empty", ".module.css": "empty" },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`
    <span id="hidden" style="display:none">Selected text</span>
    <span id="zero" style="position:absolute;left:20px;top:20px;width:0;height:12px"></span>
    <span id="clipped" style="position:absolute;left:500px;top:20px">Selected text</span>
    <span id="visible" style="position:absolute;left:30px;top:40px">Selected text</span>
    <span id="mixed" style="position:absolute;left:30px;top:80px"><span style="display:inline-block;width:0;height:12px"></span><span>Selected text</span></span>
  `);
  const measured = await page.evaluate(async (code) => {
    const url = URL.createObjectURL(
      new Blob([code], { type: "text/javascript" }),
    );
    try {
      const {
        measureSelectionAnnotation,
      }: { measureSelectionAnnotation: Measurement } = await import(url);
      return ["hidden", "zero", "clipped", "visible", "mixed"].map((id) => {
        const range = document.createRange();
        range[id === "zero" ? "selectNode" : "selectNodeContents"](
          document.getElementById(id)!,
        );
        return {
          id,
          native: range.getBoundingClientRect().toJSON(),
          rectangles: Array.from(range.getClientRects(), (rect) =>
            rect.toJSON(),
          ),
          measured:
            measureSelectionAnnotation(
              { range, sourceText: range.toString() },
              () => 0,
            )?.rect.toJSON() ?? null,
        };
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }, bundle.outputFiles[0].text);
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
});
