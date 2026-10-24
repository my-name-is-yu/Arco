import { useCallback } from "react";
import type { ArcoHost } from "../shared/contracts";
import type { LinearScope } from "../shared/linear";
import type { Settings } from "../shared/state";
import { useSettings } from "./useSettings";

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
  const { query, error, update, schedule } = useSettings(host);
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
      schedule(`linear:${key}`, (latest) => ({
        linearFilters: { ...latest.linearFilters, [key]: filter },
      }));
    },
    [schedule],
  );
  return { query, error, selectTeam, saveFilter };
}
