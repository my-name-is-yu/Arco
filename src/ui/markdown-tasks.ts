export interface MarkdownTask {
  checked: boolean;
  text: string;
}

export function markdownTasks(
  markdown: string,
): ReadonlyMap<number, MarkdownTask> {
  const tasks = new Map<number, MarkdownTask>();
  const lines = markdown.split(/\r\n|\n|\r/);
  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[index]);
    if (match) {
      if (fence) {
        if (
          match[1][0] === fence.marker &&
          match[1].length >= fence.length &&
          !match[2].trim()
        )
          fence = null;
      } else fence = { marker: match[1][0], length: match[1].length };
      continue;
    }
    if (fence) continue;
    const task = /^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\](?:\s+|$)(.*)$/.exec(
      lines[index],
    );
    if (task)
      tasks.set(index + 1, {
        checked: task[1].toLowerCase() === "x",
        text: task[2],
      });
  }
  return tasks;
}

export function markdownTaskAtLine(
  markdown: string,
  line: number,
): MarkdownTask | null {
  if (!Number.isSafeInteger(line) || line < 1) return null;
  return markdownTasks(markdown).get(line) ?? null;
}

export function toggleMarkdownTask(
  markdown: string,
  line: number,
  checked: boolean,
): string {
  if (!markdownTaskAtLine(markdown, line)) return markdown;
  const parts = markdown.split(/(\r\n|\n|\r)/);
  const index = (line - 1) * 2;
  parts[index] = parts[index].replace(
    /^(\s*(?:[-+*]|\d+[.)])\s+\[)[ xX](\])/,
    (_match, before: string, after: string) =>
      `${before}${checked ? "x" : " "}${after}`,
  );
  return parts.join("");
}
