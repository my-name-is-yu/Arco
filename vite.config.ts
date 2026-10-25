import { defineConfig } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Keep dependency provenance outside the plugin artifact.
    {
      name: "arco-ui-module-report",
      generateBundle: {
        order: "pre",
        async handler(_options, bundle) {
          await mkdir("dist/dev", { recursive: true });
          await writeFile(
            "dist/dev/ui-module-report.json",
            JSON.stringify(
              {
                modules: Object.values(bundle)
                  .filter((item) => item.type === "chunk")
                  .flatMap((chunk) =>
                    Object.entries(chunk.modules).map(([id, info]) => ({
                      id: relative(process.cwd(), id).replaceAll("\\", "/"),
                      renderedLength: info.renderedLength,
                      chunk: chunk.fileName,
                    })),
                  ),
              },
              null,
              2,
            ),
          );
        },
      },
    },
    viteSingleFile(),
  ],
  css: {
    postcss: {
      plugins: [
        // Math is disabled; remove only the unused KaTeX font declarations.
        {
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
        },
      ],
    },
  },
  build: { outDir: "dist/ui", sourcemap: false, target: "es2022" },
});
