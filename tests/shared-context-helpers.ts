import { expect } from "@playwright/test";

export type SharedAnnotation = {
  number: number;
  issue?: Record<string, unknown>;
  selection: {
    text: string;
    origin: "body" | "comment" | "ui";
    commentId?: string;
    comment?: string;
  };
};
export function sharedContextFromText(value: unknown): Record<string, unknown> {
  const update = value as {
    content: {
      type: string;
      text: string;
      annotations?: { audience?: string[] };
      _meta?: Record<string, unknown>;
    }[];
    structuredContent: Record<string, unknown>;
  };
  if (update.structuredContent.arcoAnnotationFormat === 2) {
    expect(update.structuredContent).toEqual({
      source: "arco",
      arcoAnnotationFormat: 2,
      ...(update.structuredContent.arcoAnnotationSnapshotId
        ? {
            arcoAnnotationSnapshotId: expect.stringMatching(/^[a-f0-9-]{36}$/),
          }
        : {}),
    });
    const annotations = update.content.map(
      (block) => block._meta?.["arco/annotation"] as SharedAnnotation,
    );
    const numbers = annotations.map(({ number }) => number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const [index, annotation] of annotations.entries()) {
      const block = update.content[index]!;
      const { number, issue, selection } = annotation;
      expect(Number.isInteger(number) && number > 0).toBe(true);
      expect(block.type).toBe("text");
      expect(block.annotations?.audience ?? []).not.toContain("assistant");
      expect(block._meta?.["openai/group"]).toEqual({ title: "Annotations" });
      const preview = selection.text.replace(/\s+/g, " ").trim();
      expect(block._meta?.["openai/title"]).toBe(
        preview.length > 64 ? `${preview.slice(0, 64)}…` : preview,
      );
      const identifier = issue
        ? issue.source === "github"
          ? `${issue.repo} #${issue.number}`
          : issue.identifier
        : "Arco";
      expect(block.text).toBe(
        `${identifier}\n${issue ? `${issue.url}\n` : ""}Origin: ${selection.origin}${selection.commentId ? `\nComment ID: ${selection.commentId}` : ""}\n\nSelected text:\n${selection.text}${selection.comment ? `\n\nUser comment:\n${selection.comment}` : ""}`,
      );
      expect(selection.text.trim()).not.toBe("");
      expect(["body", "comment", "ui"]).toContain(selection.origin);
      if (selection.commentId !== undefined)
        expect(selection.origin).toBe("comment");
      if (issue) expect(issue).not.toHaveProperty("body");
    }
    const first = annotations[0];
    return {
      ...(annotations.length === 1
        ? {
            ...(first!.issue ?? { source: "arco" }),
            selection: first!.selection,
          }
        : { source: "arco" }),
      annotations,
      ...(update.structuredContent.arcoAnnotationSnapshotId
        ? {
            arcoAnnotationSnapshotId:
              update.structuredContent.arcoAnnotationSnapshotId,
          }
        : {}),
    };
  }
  const hidden = update.content.filter((content) =>
    content.annotations?.audience?.includes("assistant"),
  );
  expect(hidden).toHaveLength(1);
  const modelContent = update.content.at(-1)!;
  expect(modelContent).toBe(hidden[0]);
  expect(modelContent).toMatchObject({
    type: "text",
    annotations: { audience: ["assistant"] },
  });
  expect(modelContent.annotations?.audience).toEqual(["assistant"]);
  const marker = "Issue context (source data):\n";
  expect(modelContent.text.startsWith(marker)).toBe(true);
  const context = JSON.parse(modelContent.text.slice(marker.length)) as Record<
    string,
    unknown
  >;
  const { arcoSharedIssue, ...structured } = update.structuredContent;
  expect(arcoSharedIssue).toBe(
    context.source === "github" || context.source === "linear" ? 1 : undefined,
  );
  expect(context).toEqual(structured);
  const visible = update.content.slice(0, -1);
  expect(modelContent._meta?.["openai/group"]).toEqual(
    visible[0]?._meta?.["openai/group"],
  );
  expect(modelContent._meta).not.toHaveProperty("openai/title");
  for (const content of visible) {
    expect(content.type).toBe("text");
    expect(content.annotations?.audience ?? []).not.toContain("assistant");
    expect(content.text).not.toContain(marker);
  }
  if (context.selection !== undefined)
    expect(context.annotations).toBeDefined();
  if (context.annotations !== undefined) {
    const annotations = context.annotations as SharedAnnotation[];
    expect(Array.isArray(annotations)).toBe(true);
    expect(annotations.length).toBeGreaterThan(0);
    expect(visible).toHaveLength(annotations.length);
    const numbers = annotations.map((annotation) => annotation.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const number of numbers) {
      expect(Number.isInteger(number)).toBe(true);
      expect(number).toBeGreaterThan(0);
    }
    const groupTitle = `${annotations.length} annotation${annotations.length === 1 ? "" : "s"}`;
    for (const [index, annotation] of annotations.entries()) {
      const content = visible[index]!;
      const prefix = `#${annotation.number} `;
      const title = content._meta?.["openai/title"] as string;
      expect(typeof title).toBe("string");
      expect(title.startsWith(prefix)).toBe(true);
      const excerpt = title.slice(prefix.length).replace(/…$/, "");
      expect(excerpt).not.toBe("");
      expect(
        annotation.selection.text
          .replace(/\s+/g, " ")
          .trim()
          .startsWith(excerpt),
      ).toBe(true);
      expect(content._meta?.["openai/group"]).toEqual({ title: groupTitle });
      expect(annotation.selection.text.trim()).not.toBe("");
      expect(["body", "comment", "ui"]).toContain(annotation.selection.origin);
      if (annotation.selection.comment !== undefined)
        expect(annotation.selection.comment.trim()).not.toBe("");
      const identifier = annotation.issue
        ? annotation.issue.source === "github"
          ? `${annotation.issue.repo} #${annotation.issue.number}`
          : annotation.issue.identifier
        : "Arco";
      // Exact per-item text catches accidental inclusion of another annotation,
      // including when the two selected source ranges overlap.
      expect(content.text).toBe(
        `${annotation.number}. ${identifier}\n${annotation.selection.text}${annotation.selection.comment ? `\n\nComment: ${annotation.selection.comment}` : ""}`,
      );
      if (annotation.selection.commentId !== undefined)
        expect(annotation.selection.origin).toBe("comment");
      if (annotation.issue) {
        expect(["github", "linear"]).toContain(annotation.issue.source);
        expect(annotation.issue).not.toHaveProperty("body");
      }
    }
    if (annotations.length > 1) {
      expect(context).toEqual({
        source: "arco",
        annotations,
        ...(context.arcoAnnotationSnapshotId
          ? {
              arcoAnnotationSnapshotId:
                expect.stringMatching(/^[a-f0-9-]{36}$/),
            }
          : {}),
      });
    } else {
      expect(context).toMatchObject({
        ...(annotations[0]!.issue ?? { source: "arco" }),
        selection: annotations[0]!.selection,
      });
    }
  } else {
    const title =
      context.source === "github"
        ? `${String(context.repo).split("/")[1]} #${context.number}`
        : context.identifier;
    expect(update.content).toHaveLength(2);
    expect(visible[0]).toMatchObject({
      type: "text",
      text: expect.any(String),
      _meta: {
        "openai/title": title,
        "openai/group": { title },
      },
    });
  }
  return context;
}
export function latestSharedSelection(value: unknown): Record<string, unknown> {
  const context = sharedContextFromText(value);
  const latest = (context.annotations as SharedAnnotation[] | undefined)?.at(
    -1,
  );
  return latest
    ? { ...(latest.issue ?? { source: "arco" }), selection: latest.selection }
    : context;
}
