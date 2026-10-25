import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  type IssueTemplate,
  type IssueTemplates,
} from "../../shared/github-operations";
import { type GitHubOperationContext, type Input } from "./operations-context";
import { GitHubError, parse } from "./transport";
export function createTemplatesOperations(context: GitHubOperationContext) {
  async function issueTemplates(
    input: Input<"arco_issue_templates">,
  ): Promise<IssueTemplates> {
    const official = `https://github.com/${input.repo}/issues/new/choose`;
    let templateRepo = input.repo;
    let files: {
      name: string;
      path: string;
      html_url: string | null;
      type: string;
    }[];
    try {
      files = parse(
        z.array(
          z.object({
            name: z.string(),
            path: z.string(),
            html_url: z.string().nullable(),
            type: z.string(),
          }),
        ),
        await context.api(
          "read",
          `repos/${input.repo}/contents/.github/ISSUE_TEMPLATE`,
        ),
      );
    } catch (error) {
      if (!(error instanceof GitHubError) || error.code !== "not-found")
        throw error;
      // GitHub inherits templates only from the owner's public .github repository.
      const defaultsRepo = `${input.repo.split("/")[0]}/.github`;
      if (defaultsRepo.toLowerCase() === input.repo.toLowerCase())
        return { repo: input.repo, templates: [] };
      try {
        const repository = parse(
          z.object({ private: z.boolean(), full_name: z.string() }),
          await context.api("read", `repos/${defaultsRepo}`),
        );
        if (
          repository.private ||
          repository.full_name.toLowerCase() !== defaultsRepo.toLowerCase()
        )
          return { repo: input.repo, templates: [] };
        templateRepo = defaultsRepo;
        files = parse(
          z.array(
            z.object({
              name: z.string(),
              path: z.string(),
              html_url: z.string().nullable(),
              type: z.string(),
            }),
          ),
          await context.api(
            "read",
            `repos/${templateRepo}/contents/.github/ISSUE_TEMPLATE`,
          ),
        );
      } catch (fallbackError) {
        if (
          fallbackError instanceof GitHubError &&
          fallbackError.code === "not-found"
        )
          return { repo: input.repo, templates: [] };
        throw fallbackError;
      }
    }
    const templates: IssueTemplate[] = [];
    for (const file of files) {
      if (
        file.type !== "file" ||
        file.name === "config.yml" ||
        file.name === "config.yaml"
      )
        continue;
      if (!/\.md$/i.test(file.name)) {
        templates.push({
          path: file.path,
          name: file.name,
          description: "",
          kind: "unsupported",
          reason:
            "Use GitHub for form templates or unsupported template formats.",
          url: official,
        });
        continue;
      }
      const contents = parse(
        z.object({ content: z.string(), encoding: z.literal("base64") }),
        await context.api(
          "read",
          `repos/${templateRepo}/contents/${file.path.split("/").map(encodeURIComponent).join("/")}`,
        ),
      );
      templates.push(
        classifyMarkdownTemplate(
          file.path,
          Buffer.from(contents.content, "base64").toString("utf8"),
          official,
        ),
      );
    }
    return { repo: input.repo, templates };
  }

  return { issueTemplates };
}

export function classifyMarkdownTemplate(
  path: string,
  source: string,
  url: string,
): IssueTemplate {
  const fallback: IssueTemplate = {
    path,
    name: path.split("/").at(-1) ?? path,
    description: "",
    kind: "unsupported",
    url,
    reason: "Use GitHub for templates with unsupported settings.",
  };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return fallback;
  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const entry = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (
      !entry ||
      !["name", "about", "title", "labels", "assignees", "type"].includes(
        entry[1],
      ) ||
      entry[1] in metadata
    )
      return fallback;
    const value = templateScalar(entry[2]);
    if (value === undefined) return fallback;
    metadata[entry[1]] = value;
  }
  if (!metadata.name) return fallback;
  return {
    path,
    name: metadata.name,
    description: metadata.about ?? "",
    kind: "simple",
    url,
    body: match[2],
    defaults: {
      title: metadata.title ?? "",
      ...(metadata.type ? { type: metadata.type } : {}),
      labels: (metadata.labels ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      assignees: (metadata.assignees ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    },
  };
}

function templateScalar(raw: string) {
  if ((raw.length > 0 && "[]{}>&*!|".includes(raw[0])) || /\s#/.test(raw))
    return undefined;
  if (raw.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(raw);
      return typeof decoded === "string" ? decoded : undefined;
    } catch {
      return undefined;
    }
  }
  if (raw.startsWith("'"))
    return raw.endsWith("'")
      ? raw.slice(1, -1).replaceAll("''", "'")
      : undefined;
  if (
    [...raw].some((char) => ":[]{}".includes(char)) ||
    /^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(raw)
  )
    return undefined;
  return raw;
}
