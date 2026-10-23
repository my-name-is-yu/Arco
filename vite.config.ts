import { defineConfig, type Plugin as VitePlugin } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import type { Plugin } from "postcss";

// Math is disabled; remove only the unused KaTeX font declarations by CSS AST.
const omitMathFonts: Plugin = {
  postcssPlugin: "arco-unused-math-fonts",
  AtRule: {
    "font-face"(rule) {
      if (
        rule.nodes?.some(
          (node) =>
            node.type === "decl" &&
            node.prop === "font-family" &&
            node.value.includes("KaTeX"),
        )
      )
        rule.remove();
    },
  },
};

// Keep dependency provenance in development output, outside the plugin artifact.
const reportUiModules: VitePlugin = {
  name: "arco-ui-module-report",
  generateBundle: {
    order: "pre",
    async handler(_options, bundle) {
      const chunks = Object.values(bundle).filter(
        (item) => item.type === "chunk",
      );
      const modules = chunks.flatMap((chunk) =>
        Object.entries(chunk.modules).map(([id, info]) => ({
          id: relative(process.cwd(), id).replaceAll("\\", "/"),
          renderedLength: info.renderedLength,
          chunk: chunk.fileName,
        })),
      );
      await mkdir("dist/dev", { recursive: true });
      await writeFile(
        "dist/dev/ui-module-report.json",
        JSON.stringify({ modules }, null, 2),
      );
    },
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), reportUiModules, viteSingleFile()],
  css: { postcss: { plugins: [omitMathFonts] } },
  build: { outDir: "dist/ui", sourcemap: false, target: "es2022" },
});
