import { useCallback } from "react";
import type { ArcoHost } from "../shared/contracts";
import type { LinearScope } from "../shared/linear";
import { SETTINGS_HISTORY_LIMIT, type Settings } from "../shared/state";
import { useSettings } from "./useSettings";
import { rememberSetting } from "./settings-retention";

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
  const { query, error, pending, update, schedule, retry } = useSettings(host);
  const selectTeam = useCallback(
    (scope: LinearScope, name: string) =>
      update("linear:team", (latest) => ({
        activeLinearTeam: scope.teamId,
        linearTeams: [
          ...latest.linearTeams.filter(
            (team) =>
              team.workspaceId !== scope.workspaceId ||
              team.teamId !== scope.teamId,
          ),
          { workspaceId: scope.workspaceId, teamId: scope.teamId, name },
        ].slice(-SETTINGS_HISTORY_LIMIT),
      })),
    [update],
  );
  const saveFilter = useCallback(
    (scope: LinearScope, filter: LinearFilter) => {
      const key = linearScopeKey(scope);
      schedule(`linear:${key}`, (latest) => ({
        linearFilters: rememberSetting(latest.linearFilters, key, filter),
      }));
    },
    [schedule],
  );
  return { query, error, pending, retry, selectTeam, saveFilter };
}
