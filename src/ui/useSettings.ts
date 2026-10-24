import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { ArcoHost } from "../shared/contracts";
import {
  settingsRecordSchema,
  type Settings,
  type SettingsRecord,
} from "../shared/state";
import { enqueueSettingsWrite } from "./settings-queue";
import { sessionValue } from "./session-state";
type Patch = (latest: Settings) => Partial<Settings>;
function settingsController(host: ArcoHost, client: QueryClient) {
  return sessionValue(host, "settings-controller", () => {
    let state: { error: string | null; pending: boolean } = {
      error: null,
      pending: false,
    };
    let writes = 0;
    const listeners = new Set<() => void>();
    const timers = new Map<
      string,
      { timer: ReturnType<typeof setTimeout>; build: Patch }
    >();
    const publish = (patch: Partial<typeof state>) => {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    };
    const update = (build: Patch) => {
      writes += 1;
      publish({ pending: true, error: null });
      void enqueueSettingsWrite(host, async () => {
        try {
          const latest = settingsRecordSchema.parse(
            await host.call<SettingsRecord>("arco_get_settings", {}),
          );
          const patch = build(latest.settings);
          const unchanged = Object.entries(patch).every(
            ([key, value]) =>
              JSON.stringify(latest.settings[key as keyof Settings]) ===
              JSON.stringify(value),
          );
          const saved = unchanged
            ? latest
            : settingsRecordSchema.parse(
                await host.call<SettingsRecord>("arco_update_settings", {
                  expectedRevision: latest.revision,
                  patch,
                }),
              );
          client.setQueryData(["settings"], saved);
        } catch (failure) {
          publish({
            error: failure instanceof Error ? failure.message : String(failure),
          });
          await client.invalidateQueries({ queryKey: ["settings"] });
        } finally {
          writes -= 1;
          publish({ pending: writes > 0 });
        }
      });
    };
    const flush = () => {
      for (const [key, entry] of timers) {
        clearTimeout(entry.timer);
        timers.delete(key);
        update(entry.build);
      }
    };
    return {
      get: () => state,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      update,
      schedule(key: string, build: Patch) {
        const previous = timers.get(key);
        if (previous) clearTimeout(previous.timer);
        const timer = setTimeout(() => {
          timers.delete(key);
          update(build);
        }, 300);
        timers.set(key, { timer, build });
      },
      flush,
    };
  });
}
export function useSettings(host: ArcoHost) {
  const client = useQueryClient();
  const controller = useMemo(
    () => settingsController(host, client),
    [host, client],
  );
  const status = useSyncExternalStore(controller.subscribe, controller.get);
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: async () =>
      settingsRecordSchema.parse(
        await host.call<SettingsRecord>("arco_get_settings", {}),
      ),
  });
  useEffect(() => () => controller.flush(), [controller]);
  return {
    query,
    ...status,
    update: controller.update,
    schedule: controller.schedule,
  };
}
