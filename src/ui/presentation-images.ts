import { useMemo } from "react";
import { queryOptions, useQueries } from "@tanstack/react-query";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { ArcoHost, ConversationIssue } from "../shared/contracts";
import { MAX_PRESENTED_ISSUES } from "../shared/launch";

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
    ],
    queryFn: ({ signal }) => {
      if (!host || !issue || !normalizedUrl)
        throw new Error("An issue and a valid image URL are required.");
      return host.readImage(issue, normalizedUrl, commentId, {
        signal,
        priority: "background",
      });
    },
    enabled: Boolean(host && issue && normalizedUrl),
    retry: false,
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
  });
}

export function presentationImageQueries(
  host: Pick<ArcoHost, "readImage">,
  issues: ConversationIssue[],
) {
  return issues.slice(0, MAX_PRESENTED_ISSUES).flatMap((issue) => {
    const url = firstMarkdownImage(issue.body);
    return url ? [sourceImageQueryOptions(host, issue, url)] : [];
  });
}

export function usePresentationImagePrefetch(
  host: ArcoHost,
  issues: ConversationIssue[],
) {
  const queries = useMemo(
    () => presentationImageQueries(host, issues),
    [host, issues],
  );
  // Keep only these image reads observed while the group is open. SourceImage
  // shares their cache, and the last observer leaving cancels queued reads.
  useQueries({ queries });
}
