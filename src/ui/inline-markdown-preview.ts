import { fromMarkdown } from "mdast-util-from-markdown";

export function inlineMarkdownPreview(body: string) {
  const nodes = fromMarkdown(body).children;
  const content = nodes.filter((node) => node.type !== "definition");
  const included = [];
  let hasContent = false;
  for (const [index, node] of content.entries()) {
    const nextEnd = node.position?.end.offset ?? body.length;
    if (hasContent && (index >= 3 || nextEnd > 600)) break;
    included.push(node);
    if (node.type !== "heading") hasContent = true;
  }
  while (
    included.length < content.length &&
    included.at(-1)?.type === "heading"
  )
    included.pop();
  const end = included.at(-1)?.position?.end.offset ?? 0;
  const hasMoreBlocks = end < (content.at(-1)?.position?.end.offset ?? 0);
  const expandable =
    hasMoreBlocks || body.length > 600 || body.split(/\r\n|\n|\r/).length > 8;
  if (!hasMoreBlocks) return { body, expandable };
  const definitions = nodes
    .filter((node) => node.type === "definition")
    .map((node) =>
      body.slice(node.position?.start.offset, node.position?.end.offset),
    );
  return {
    body: [body.slice(0, end), ...definitions].join("\n\n"),
    expandable,
  };
}
