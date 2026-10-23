import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountIssuesInput, ArcoHost } from "../shared/contracts";
import { enqueueSettingsWrite } from "./settings-queue";
import {
  settingsRecordSchema,
  type Settings,
  type SettingsRecord,
} from "../shared/state";

export function useGitHubSettings(
  host: ArcoHost,
  project?: { key: string | null },
) {
  const projectView = project !== undefined;
  const projectKey = project?.key;
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: async () =>
      settingsRecordSchema.parse(
        await host.call<SettingsRecord>("arco_get_settings", {}),
      ),
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tail = useRef(Promise.resolve());
  const filterTimers = useRef(
    new Map<
      string,
      { timer: ReturnType<typeof setTimeout>; flush: () => void }
    >(),
  );
  const update = useCallback(
    (build: (latest: Settings) => Partial<Settings>) => {
      setPending(true);
      setError(null);
      const save = enqueueSettingsWrite(host, async () => {
        try {
          const latest = settingsRecordSchema.parse(
            await host.call<SettingsRecord>("arco_get_settings", {}),
          );
          const patch = build(latest.settings);
          if (
            Object.entries(patch).every(
              ([key, value]) =>
                JSON.stringify(latest.settings[key as keyof Settings]) ===
                JSON.stringify(value),
            )
          ) {
            client.setQueryData(["settings"], latest);
            return;
          }
          const saved = settingsRecordSchema.parse(
            await host.call<SettingsRecord>("arco_update_settings", {
              expectedRevision: latest.revision,
              patch,
            }),
          );
          client.setQueryData(["settings"], saved);
        } catch (failure) {
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
          await client.invalidateQueries({ queryKey: ["settings"] });
        }
      });
      tail.current = save;
      void save.finally(() => {
        if (tail.current === save) setPending(false);
      });
    },
    [client, host],
  );
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
    (repo: string, filter: Settings["githubFilters"][string]) => {
      const previous = filterTimers.current.get(repo);
      if (previous) clearTimeout(previous.timer);
      const flush = () => {
        filterTimers.current.delete(repo);
        update((latest) => ({
          githubFilters: { ...latest.githubFilters, [repo]: filter },
        }));
      };
      filterTimers.current.set(repo, { timer: setTimeout(flush, 300), flush });
    },
    [update],
  );
  useEffect(() => {
    const timers = filterTimers.current;
    return () => {
      for (const entry of [...timers.values()]) {
        clearTimeout(entry.timer);
        entry.flush();
      }
      timers.clear();
    };
  }, []);
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
