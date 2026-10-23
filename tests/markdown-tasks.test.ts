import { describe, expect, it } from "vitest";
import {
  markdownTaskAtLine,
  toggleMarkdownTask,
} from "../src/ui/markdown-tasks";

describe("source-preserving Markdown task edits", () => {
  it("changes only the selected task marker, retaining nested lists, syntax and CRLF", () => {
    const original =
      "## Tasks\r\n\r\n- [ ] Parent **task**\r\n  - [X] Nested task\r\n\r\nUntouched [ ] text\r\n";
    expect(toggleMarkdownTask(original, 4, false)).toBe(
      original.replace("[X] Nested", "[ ] Nested"),
    );
    expect(toggleMarkdownTask(original, 3, true)).toBe(
      original.replace("[ ] Parent", "[x] Parent"),
    );
  });
  it("does not change fake task lines inside backtick or tilde fences", () => {
    const original =
      "```md\n- [ ] Example\n```\n~~~\n- [x] Other example\n~~~\n- [ ] Real task";
    expect(markdownTaskAtLine(original, 2)).toBeNull();
    expect(toggleMarkdownTask(original, 5, false)).toBe(original);
    expect(toggleMarkdownTask(original, 7, true)).toBe(
      original.replace("[ ] Real", "[x] Real"),
    );
  });
  it("accepts ordered tasks and ignores ordinary text or invalid line positions", () => {
    expect(toggleMarkdownTask("1. [ ] Ordered\nplain [ ] text", 1, true)).toBe(
      "1. [x] Ordered\nplain [ ] text",
    );
    expect(toggleMarkdownTask("plain [ ] text", 1, true)).toBe(
      "plain [ ] text",
    );
    expect(toggleMarkdownTask("- [ ] Task", 0, true)).toBe("- [ ] Task");
    expect(toggleMarkdownTask("- [ ] Task", 8, true)).toBe("- [ ] Task");
  });
});
