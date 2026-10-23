function attachment(
  context: Record<string, unknown>,
  items: { text: string; title: string }[],
  groupTitle: string,
) {
  return {
    content: [
      ...items.map(({ text, title }) => ({
        type: "text" as const,
        text,
        _meta: {
          "openai/title": title,
          "openai/group": { title: groupTitle },
        },
      })),
      {
        type: "text" as const,
        text: `Issue context (source data):\n${JSON.stringify(context)}`,
        annotations: { audience: ["assistant" as const] },
        _meta: { "openai/group": { title: groupTitle } },
      },
    ],
    structuredContent: {
      ...context,
      ...(context.source === "github" || context.source === "linear"
        ? { arcoSharedIssue: 1 }
        : {}),
    },
  };
}

export function contextAttachment(
  context: Record<string, unknown>,
  text: string,
  title: string,
) {
  return attachment(context, [{ text, title }], "Arco");
}

export function annotationAttachment(
  context: Record<string, unknown>,
  items: { text: string; title: string }[],
) {
  return attachment(
    context,
    items,
    `${items.length} annotation${items.length === 1 ? "" : "s"}`,
  );
}
