import { useCallback } from "react";
import type { AccountIssuesInput, ArcoHost } from "../shared/contracts";
import { SETTINGS_HISTORY_LIMIT, type Settings } from "../shared/state";
import { useSettings } from "./useSettings";
import { rememberSetting } from "./settings-retention";

export function useGitHubSettings(
  host: ArcoHost,
  project?: { key: string | null },
) {
  const projectView = project !== undefined;
  const projectKey = project?.key;
  const { query, error, pending, update, schedule, retry } = useSettings(host);
  const register = useCallback(
    (repo: string, additional: string[] = []) =>
      update("github:scope", (latest) => ({
        githubRepos: [
          ...new Set(
            [...latest.githubRepos, ...additional].filter(
              (saved) => saved !== repo,
            ),
          ),
          repo,
        ].slice(-SETTINGS_HISTORY_LIMIT),
        ...(projectView
          ? projectKey
            ? {
                projectGithubRepos: rememberSetting(
                  latest.projectGithubRepos,
                  projectKey,
                  repo,
                ),
              }
            : {}
          : { activeGithubRepo: repo }),
      })),
    [update, projectView, projectKey],
  );
  const setSource = useCallback(
    (source: "github" | "linear") =>
      update("source", () => ({ activeSource: source })),
    [update],
  );
  const setAccountScope = useCallback(
    (filter?: AccountIssuesInput["filter"]) => {
      update("github:scope", () => ({ activeGithubRepo: null }));
      if (filter)
        update("github:account-filter", (latest) => ({
          githubAccountFilter: { ...latest.githubAccountFilter, filter },
        }));
    },
    [update],
  );
  const saveAccountFilter = useCallback(
    (filter: Settings["githubAccountFilter"]) =>
      update("github:account-filter", () => ({ githubAccountFilter: filter })),
    [update],
  );
  const saveFilter = useCallback(
    (repo: string, filter: Settings["githubFilters"][string]) =>
      schedule(`github:${repo}`, (latest) => ({
        githubFilters: rememberSetting(latest.githubFilters, repo, filter),
      })),
    [schedule],
  );
  return {
    query,
    error,
    pending,
    retry,
    register,
    setSource,
    setAccountScope,
    saveAccountFilter,
    saveFilter,
  };
}
