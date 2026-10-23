import type { IssueRef } from "./contracts";

export const isIssueUrlInput = (value: string) =>
  /^(?:[a-z][a-z\d+.-]*:\/\/|(?:https?|javascript|data|file|mailto):|\/\/|(?:www\.)?(?:github\.com|linear\.app)(?:\/|$))/i.test(
    value.trim(),
  );

function nativeUrl(value: string, origin: string): URL {
  const input = value.trim();
  if (
    input.length > 2048 ||
    /[\s\\]/.test(input) ||
    [...input].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error("Paste a valid HTTPS issue URL.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Paste a valid HTTPS issue URL.");
  }
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    /%(?:2e|2f|5c)/i.test(url.pathname) ||
    /\/(?:\.|\.\.)(?:\/|$)/.test(input.split(/[?#]/, 1)[0])
  )
    throw new Error(`Use an issue URL from ${origin}.`);
  return url;
}

export function githubIssueUrl(value: string): IssueRef {
  const url = nativeUrl(value, "https://github.com");
  const match =
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9]\d*)\/?$/.exec(
      url.pathname,
    );
  const number = Number(match?.[3]);
  if (
    !match ||
    !Number.isSafeInteger(number) ||
    [match[1], match[2]].some((part) => part === "." || part === "..")
  )
    throw new Error(
      "Use a GitHub issue URL ending in /issues/number. Pull request URLs are not supported.",
    );
  return { repo: `${match[1]}/${match[2]}`, number };
}

export function githubRepositoryUrl(value: string): string {
  const url = nativeUrl(value, "https://github.com");
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(
    url.pathname,
  );
  if (
    !match ||
    [match[1], match[2]].some((part) => part === "." || part === "..")
  )
    throw new Error("Use a GitHub repository or issue URL.");
  return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
}

export function linearIssueUrl(value: string): {
  workspace: string;
  identifier: string;
} {
  const url = nativeUrl(value, "https://linear.app");
  const match =
    /^\/([A-Za-z0-9][A-Za-z0-9_-]*)\/issue\/([A-Za-z0-9]+-[1-9]\d*)(?:\/[^/]+)?\/?$/.exec(
      url.pathname,
    );
  if (!match)
    throw new Error(
      "Use a Linear issue URL containing /workspace/issue/TEAM-number.",
    );
  return {
    workspace: match[1].toLowerCase(),
    identifier: match[2].toUpperCase(),
  };
}
