import { useMemo } from "react";
import {
  queryOptions,
  useQueries,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { ArcoHost, ConversationIssue } from "../shared/contracts";
import { MAX_PRESENTED_ISSUES } from "../shared/launch";
import { isGitHubAuthScope } from "./github-auth";

export function safeMarkdownUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function firstMarkdownImage(body: string): string | undefined {
  const tree = fromMarkdown(body);
  type Node = typeof tree | (typeof tree.children)[number];
  const definitions = new Map<string, string>();
  function collect(node: Node) {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    if ("children" in node) node.children.forEach(collect);
  }
  collect(tree);
  function find(node: Node): string | undefined {
    const value =
      node.type === "image"
        ? node.url
        : node.type === "imageReference"
          ? definitions.get(node.identifier)
          : undefined;
    if (value) {
      const url = safeMarkdownUrl(value);
      if (url) return url;
    }
    if ("children" in node) {
      for (const child of node.children) {
        const url = find(child);
        if (url) return url;
      }
    }
  }
  return find(tree);
}

export function sourceImageQueryOptions(
  host: Pick<ArcoHost, "readImage"> | undefined,
  issue: ConversationIssue | undefined,
  url: string,
  commentId?: string | number,
  githubAuthScope?: string,
  client?: QueryClient,
) {
  const normalizedUrl = safeMarkdownUrl(url);
  const sourceRef =
    issue?.source === "github"
      ? [issue.repo, issue.number]
      : issue?.source === "linear"
        ? [issue.connectionId, issue.workspaceId, issue.teamId, issue.issueId]
        : [];
  return queryOptions({
    queryKey: [
      "source-image",
      issue?.source,
      ...sourceRef,
      commentId,
      normalizedUrl ?? url,
      ...(issue?.source === "github" ? [githubAuthScope] : []),
    ],
    queryFn: ({ signal }) => {
      if (!host || !issue || !normalizedUrl)
        throw new Error("An issue and a valid image URL are required.");
      if (
        issue.source === "github" &&
        (!githubAuthScope ||
          (client && !isGitHubAuthScope(client, githubAuthScope)))
      )
        throw new Error("GitHub authentication changed. Refresh this image.");
      return host.readImage(issue, normalizedUrl, commentId, {
        signal,
        priority: "background",
      });
    },
    enabled: Boolean(
      host &&
      issue &&
      normalizedUrl &&
      (issue.source !== "github" || githubAuthScope),
    ),
    retry: false,
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
  });
}

export function presentationImageQueries(
  host: Pick<ArcoHost, "readImage">,
  issues: ConversationIssue[],
  githubAuthScope?: string,
  client?: QueryClient,
) {
  return issues.slice(0, MAX_PRESENTED_ISSUES).flatMap((issue) => {
    if (issue.source === "github" && !githubAuthScope) return [];
    const url = firstMarkdownImage(issue.body);
    return url
      ? [
          sourceImageQueryOptions(
            host,
            issue,
            url,
            undefined,
            githubAuthScope,
            client,
          ),
        ]
      : [];
  });
}

export function usePresentationImagePrefetch(
  host: ArcoHost,
  issues: ConversationIssue[],
  githubAuthScope?: string,
) {
  const client = useQueryClient();
  const queries = useMemo(
    () => presentationImageQueries(host, issues, githubAuthScope, client),
    [host, issues, githubAuthScope, client],
  );
  // Keep only these image reads observed while the group is open. SourceImage
  // shares their cache, and the last observer leaving cancels queued reads.
  useQueries({ queries });
}
