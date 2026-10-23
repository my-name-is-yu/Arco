import { describe, expect, it } from "vitest";
import {
  githubIssueUrl,
  githubRepositoryUrl,
  isIssueUrlInput,
  linearIssueUrl,
} from "../src/shared/issue-url";

describe("native Issue URL targets", () => {
  it("opens exact GitHub targets independently of the currently selected repository", () => {
    expect(
      githubIssueUrl(
        " https://github.com/other/project/issues/123?notification_referrer_id=1#issuecomment-2 ",
      ),
    ).toEqual({ repo: "other/project", number: 123 });
    expect(githubRepositoryUrl("https://github.com/other/project.git")).toBe(
      "other/project",
    );
  });
  it.each([
    "https://github.com/other/project/pull/123",
    "https://github.com.evil.test/other/project/issues/123",
    "https://github.com@evil.test/other/project/issues/123",
    "https://evil@github.com/other/project/issues/123",
    "http://github.com/other/project/issues/123",
    "https://github.com:444/other/project/issues/123",
    "https://github.com/other/project/issues/0",
    "https://github.com/other/project/issues/9007199254740992",
    "https://github.com/other/project/issues/1/extra",
    "https://github.com/other/../project/issues/1",
    "https://github.com/other%2fproject/issues/1",
    "https://github.com\\evil.test/other/project/issues/1",
  ])("rejects a non-native GitHub Issue target: %s", (url) => {
    expect(() => githubIssueUrl(url)).toThrow();
  });
  it("accepts a Linear title slug and comment anchor while preserving workspace and native identifier", () => {
    expect(
      linearIssueUrl(
        "https://linear.app/another-workspace/issue/ENG-42/readable-title#comment-1",
      ),
    ).toEqual({ workspace: "another-workspace", identifier: "ENG-42" });
  });
  it.each([
    "https://linear.app.evil.test/workspace/issue/ENG-42",
    "https://user@linear.app/workspace/issue/ENG-42",
    "http://linear.app/workspace/issue/ENG-42",
    "https://linear.app/workspace/project/ENG-42",
    "https://linear.app/workspace/issue/ENG-0",
    "https://linear.app/workspace/issue/ENG-42/title/extra",
    "https://linear.app/workspace/issue/ENG%2d42",
    "https://linear.app/workspace/../other/issue/ENG-42",
  ])("rejects a non-native Linear Issue target: %s", (url) => {
    expect(() => linearIssueUrl(url)).toThrow();
  });
  it("distinguishes ordinary title queries from URLs that require resolution or rejection", () => {
    expect(isIssueUrlInput("fix the search field")).toBe(false);
    expect(isIssueUrlInput("label:bug assignee:yu")).toBe(false);
    for (const input of [
      "https://example.com/issue/42",
      "github.com/other/project/issues/1",
      "javascript:alert(1)",
      "//linear.app/other/issue/TST-1",
    ])
      expect(isIssueUrlInput(input)).toBe(true);
  });
});
