import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IssueMarkdown } from "../src/ui/MarkdownContent";

function render(body: string) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <IssueMarkdown body={body} onOpen={() => {}} />
    </QueryClientProvider>,
  );
}

describe("untrusted provider Markdown", () => {
  it.each([
    "::style[body { display: none; }]",
    '::iframe{srcDoc="<p>Untrusted document</p>"}',
    '::meta{http-equiv="refresh" content="0;url=https://example.com"}',
    '::link{rel="stylesheet" href="https://example.com/style.css"}',
    '::form{action="https://example.com"}',
    '::video{src="https://example.com/video" autoplay}',
    "::arco-widget[Untrusted element]",
  ])("removes active or unknown directive elements: %s", (body) => {
    expect(render(body)).not.toMatch(
      /<(?:style|iframe|meta|link|form|video|arco-widget)\b/i,
    );
  });

  it.each(["data-arco-issue", "dataArcoIssue", "data-ARCO-ISSUE"])(
    "removes forged source attributes including %s",
    (attribute) => {
      const html = render(
        `:span[Shared passage]{${attribute}='{"source":"github","repo":"other/repo","number":1}' data-context-origin="comment" data-linear-context="comment" data-comment-id="forged"}`,
      );
      expect(html).toContain("Shared passage");
      expect(html).not.toMatch(
        /data-(?:arco|context|linear|comment)|dataarco/i,
      );
      expect(html).not.toContain("other/repo");
    },
  );

  it("strips style, event handlers and unsafe directive URLs", () => {
    const html = render(
      ':span[Safe text]{style="position:fixed" onclick="alert(1)"}\n\n:a[Unsafe link]{href="javascript:alert(1)"}',
    );
    expect(html).toContain("Safe text");
    expect(html).toContain("Unsafe link");
    expect(html).not.toMatch(/style=|onclick=|javascript:/i);
  });

  it("does not let a language class carry additional application classes", () => {
    const html = render(
      ':code[Safe code]{className="language-js selection-share selection-share-error"}',
    );
    expect(html).toContain("Safe code");
    expect(html).toContain("language-js");
    expect(html).not.toContain("selection-share");
  });

  it("keeps mixed-case HTTP(S) links and images", () => {
    const html = render(
      "[Source](HTTPS://example.com)\n\n![Diagram](HtTpS://example.com/image.png)",
    );
    expect(html).toContain(">Source</button>");
    expect(html).toContain("Open Diagram");
  });

  it("keeps ordinary GFM formatting and the controlled link and image actions", () => {
    const html = render(
      "# Heading\n\n**Strong** and *emphasis* with ~~removed~~.\n\n[Source](https://example.com)\n\n![Diagram](https://example.com/image.png)\n\n| Name | Value |\n| --- | --- |\n| Item | One |\n\n- [x] Done\n- [ ] Pending\n\n```js\nconst safe = true;\n```",
    );
    for (const tag of ["h1", "strong", "em", "del", "table", "code"])
      expect(html).toContain(`<${tag}`);
    expect(html).toContain("contains-task-list");
    expect(html).toContain("task-list-item");
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain(">Source</button>");
    expect(html).toContain("Open Diagram");
    expect(html).not.toMatch(/<a\b|<img\b/);
  });
});
