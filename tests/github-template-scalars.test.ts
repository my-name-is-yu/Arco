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
    ...[" \t", "\r", "\u2028", "\u2029"].map((space) => ({
      source: `${space}Trimmed${space} \t`,
      description: "Trimmed",
    })),
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
    "'first\rsecond'",
    "'first\u2028second'",
    "'first\u2029second'",
  ])("keeps unsupported scalar %s in GitHub", (source) => {
    const result = template(source);
    expect(result.kind).toBe("unsupported");
    expect(result).not.toHaveProperty("defaults");
    expect(result).not.toHaveProperty("body");
  });

  it.each([" name", "\tname", "name ", "name\t"])(
    "keeps whitespace around metadata key %j unsupported",
    (key) => {
      expect(
        classifyMarkdownTemplate(
          ".github/ISSUE_TEMPLATE/example.md",
          `---\n${key}: Example\n---\nIssue body`,
          "https://github.com/example/repo/issues/new/choose",
        ).kind,
      ).toBe("unsupported");
    },
  );

  it("preserves a long description's interior whitespace, body, and defaults", () => {
    const description = `x${" ".repeat(64_000)}y`;
    expect(
      classifyMarkdownTemplate(
        ".github/ISSUE_TEMPLATE/example.md",
        `---\nname: Example\nabout: ${description}\ntitle: Prefix\nlabels: bug, docs\nassignees: octocat\ntype: Bug\n---\nIssue body`,
        "https://github.com/example/repo/issues/new/choose",
      ),
    ).toEqual({
      path: ".github/ISSUE_TEMPLATE/example.md",
      name: "Example",
      description,
      kind: "simple",
      url: "https://github.com/example/repo/issues/new/choose",
      body: "Issue body",
      defaults: {
        title: "Prefix",
        type: "Bug",
        labels: ["bug", "docs"],
        assignees: ["octocat"],
      },
    });
  });
});
