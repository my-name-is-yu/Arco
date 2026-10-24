import { describe, expect, it } from "vitest";
import { inlineMarkdownPreview } from "../src/ui/inline-markdown-preview";

describe("inline Markdown preview", () => {
  it("keeps short descriptions complete", () => {
    const body = "## Goal\n\nRead **formatted** issue text.";
    expect(inlineMarkdownPreview(body)).toEqual({ body, expandable: false });
  });

  it("stops at a complete block and keeps reference links resolvable", () => {
    const body =
      "## Goal\n\nRead [the source][source].\n\n- First\n- Second\n\nA later paragraph.\n\n[source]: https://example.com";
    const preview = inlineMarkdownPreview(body);
    expect(preview.expandable).toBe(true);
    expect(preview.body).toContain("- First\n- Second");
    expect(preview.body).toContain("[source]: https://example.com");
    expect(preview.body).not.toContain("A later paragraph.");
  });

  it("keeps fenced code intact and allows oversized single blocks to expand", () => {
    const body = `\`\`\`ts\n${"const example = true;\n".repeat(40)}\`\`\``;
    expect(inlineMarkdownPreview(body)).toEqual({ body, expandable: true });
  });

  it("does not leave a heading without its following paragraph", () => {
    const body =
      "A short introduction.\n\n- One item\n\n## Later section\n\nLater content.";
    expect(inlineMarkdownPreview(body).body).toBe(
      "A short introduction.\n\n- One item",
    );
  });
});
