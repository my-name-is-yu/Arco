import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArcoHost } from "../shared/contracts";
import { enqueueSettingsWrite } from "./settings-queue";
import type { LinearScope } from "../shared/linear";
import {
  settingsRecordSchema,
  type Settings,
  type SettingsRecord,
} from "../shared/state";

export const linearScopeKey = (scope: LinearScope) => JSON.stringify(scope);
export type LinearFilter = Settings["linearFilters"][string];
export const defaultLinearFilter: LinearFilter = {
  query: "",
  stateId: "",
  assigneeId: "",
  labelId: "",
  projectId: "",
  order: "updatedAt",
};
export function useLinearSettings(host: ArcoHost) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: async () =>
      settingsRecordSchema.parse(
        await host.call<SettingsRecord>("arco_get_settings", {}),
      ),
  });
  const [error, setError] = useState("");
  const timers = useRef(
    new Map<
      string,
      { timer: ReturnType<typeof setTimeout>; flush: () => void }
    >(),
  );
  const update = useCallback(
    (build: (latest: Settings) => Partial<Settings>) => {
      setError("");
      void enqueueSettingsWrite(host, async () => {
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
          )
            return;
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
    },
    [host, client],
  );
  const selectTeam = useCallback(
    (scope: LinearScope, name: string) =>
      update((latest) => ({
        activeLinearTeam: scope.teamId,
        linearTeams: [
          ...latest.linearTeams.filter(
            (team) =>
              team.workspaceId !== scope.workspaceId ||
              team.teamId !== scope.teamId,
          ),
          { workspaceId: scope.workspaceId, teamId: scope.teamId, name },
        ],
      })),
    [update],
  );
  const saveFilter = useCallback(
    (scope: LinearScope, filter: LinearFilter) => {
      const key = linearScopeKey(scope);
      const prior = timers.current.get(key);
      if (prior) clearTimeout(prior.timer);
      const flush = () => {
        timers.current.delete(key);
        update((latest) => ({
          linearFilters: { ...latest.linearFilters, [key]: filter },
        }));
      };
      timers.current.set(key, { timer: setTimeout(flush, 300), flush });
    },
    [update],
  );
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const entry of [...pending.values()]) {
        clearTimeout(entry.timer);
        entry.flush();
      }
      pending.clear();
    };
  }, []);
  return { query, error, selectTeam, saveFilter };
}
