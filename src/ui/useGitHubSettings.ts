import { useCallback } from "react";
import type { AccountIssuesInput, ArcoHost } from "../shared/contracts";
import type { Settings } from "../shared/state";
import { useSettings } from "./useSettings";

export function useGitHubSettings(
  host: ArcoHost,
  project?: { key: string | null },
) {
  const projectView = project !== undefined;
  const projectKey = project?.key;
  const { query, error, pending, update, schedule } = useSettings(host);
  const register = useCallback(
    (repo: string, additional: string[] = []) =>
      update((latest) => ({
        githubRepos: [
          ...new Set(
            [...latest.githubRepos, ...additional].filter(
              (saved) => saved !== repo,
            ),
          ),
          repo,
        ].slice(-100),
        ...(projectView
          ? projectKey
            ? {
                projectGithubRepos: Object.fromEntries(
                  [
                    ...Object.entries(latest.projectGithubRepos).filter(
                      ([key]) => key !== projectKey,
                    ),
                    [projectKey, repo],
                  ].slice(-100),
                ),
              }
            : {}
          : { activeGithubRepo: repo }),
      })),
    [update, projectView, projectKey],
  );
  const setSource = useCallback(
    (source: "github" | "linear") => update(() => ({ activeSource: source })),
    [update],
  );
  const setAccountScope = useCallback(
    (filter?: AccountIssuesInput["filter"]) =>
      update((latest) => ({
        activeGithubRepo: null,
        githubAccountFilter: {
          ...latest.githubAccountFilter,
          ...(filter ? { filter } : {}),
        },
      })),
    [update],
  );
  const saveAccountFilter = useCallback(
    (filter: Settings["githubAccountFilter"]) =>
      update(() => ({ githubAccountFilter: filter })),
    [update],
  );
  const saveFilter = useCallback(
    (repo: string, filter: Settings["githubFilters"][string]) =>
      schedule(`github:${repo}`, (latest) => ({
        githubFilters: { ...latest.githubFilters, [repo]: filter },
      })),
    [schedule],
  );
  return {
    query,
    error,
    pending,
    register,
    setSource,
    setAccountScope,
    saveAccountFilter,
    saveFilter,
  };
}
