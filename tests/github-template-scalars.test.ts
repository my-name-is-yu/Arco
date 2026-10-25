import { describe, expect, it } from "vitest";
import { classifyMarkdownTemplate } from "../src/server/github/templates";

function template(description: string) {
  return classifyMarkdownTemplate(
    ".github/ISSUE_TEMPLATE/example.md",
    `---\nname: Example\nabout: ${description}\n---\nIssue body`,
    "https://github.com/example/repo/issues/new/choose",
  );
}

describe("GitHub template scalar values", () => {
  it.each([
    { source: "Plain text", description: "Plain text" },
    { source: '"Text with \\"quotes\\""', description: 'Text with "quotes"' },
    { source: "'It''s supported'", description: "It's supported" },
    { source: '"line\\nbreak"', description: "line\nbreak" },
    { source: '"false"', description: "false" },
    { source: "'12'", description: "12" },
    { source: '""', description: "" },
    { source: "''", description: "" },
    { source: "", description: "" },
  ])("preserves supported scalar $source", ({ source, description }) => {
    expect(template(source)).toMatchObject({
      kind: "simple",
      name: "Example",
      description,
      body: "Issue body",
    });
  });

  it.each([
    '"unterminated',
    "'unterminated",
    '"quoted" trailing',
    "[one, two]",
    "key: value",
    "true",
    "FALSE",
    "null",
    "~",
    "12",
    "-1.5",
    "text # comment",
    "&anchor",
    "| block",
  ])("keeps unsupported scalar %s in GitHub", (source) => {
    const result = template(source);
    expect(result.kind).toBe("unsupported");
    expect(result).not.toHaveProperty("defaults");
    expect(result).not.toHaveProperty("body");
  });
});
