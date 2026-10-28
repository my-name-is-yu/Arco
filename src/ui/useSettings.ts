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
import { sessionValue } from "./session-state";
import { ToolCallError } from "../shared/errors";
type Patch = (latest: Settings) => Partial<Settings>;
function readSettings(value: unknown): SettingsRecord {
  const parsed = settingsRecordSchema.safeParse(value);
  if (!parsed.success)
    throw new ToolCallError(
      "invalid-response",
      "Could not read the saved settings. Reopen Arco and try again.",
    );
  return parsed.data;
}
export function settingsController(host: ArcoHost, client: QueryClient) {
  return sessionValue(host, "settings-controller", () => {
    let state: { error: string | null; pending: boolean } = {
      error: null,
      pending: false,
    };
    let writes = 0;
    let queue = Promise.resolve();
    const failed = new Map<string, { build: Patch; error: string }>();
    const versions = new Map<string, number>();
    const listeners = new Set<() => void>();
    const timers = new Map<
      string,
      { timer: ReturnType<typeof setTimeout>; build: Patch; version: number }
    >();
    const publishStatus = () => {
      state = {
        error: [...failed.values()].at(-1)?.error ?? null,
        pending: writes > 0 || timers.size > 0,
      };
      listeners.forEach((listener) => listener());
    };
    const advance = (key: string) => {
      const scheduled = timers.get(key);
      if (scheduled) clearTimeout(scheduled.timer);
      timers.delete(key);
      failed.delete(key);
      const version = (versions.get(key) ?? 0) + 1;
      versions.set(key, version);
      return version;
    };
    const write = (key: string, build: Patch, version: number) => {
      writes += 1;
      publishStatus();
      queue = queue.catch(() => undefined);
      queue = queue.then(async () => {
        try {
          const latest = readSettings(
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
            : readSettings(
                await host.call<SettingsRecord>("arco_update_settings", {
                  expectedRevision: latest.revision,
                  patch,
                }),
              );
          client.setQueryData(["settings"], saved);
        } catch (failure) {
          if (versions.get(key) === version)
            failed.set(key, {
              build,
              error:
                failure instanceof Error ? failure.message : String(failure),
            });
          await client.invalidateQueries({ queryKey: ["settings"] });
        } finally {
          writes -= 1;
          publishStatus();
        }
      });
    };
    const update = (key: string, build: Patch) =>
      write(key, build, advance(key));
    const flush = () => {
      for (const [key, entry] of timers) {
        clearTimeout(entry.timer);
        timers.delete(key);
        write(key, entry.build, entry.version);
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
      retry() {
        for (const [key, entry] of [...failed]) update(key, entry.build);
      },
      schedule(key: string, build: Patch) {
        const version = advance(key);
        const timer = setTimeout(() => {
          timers.delete(key);
          write(key, build, version);
        }, 300);
        timers.set(key, { timer, build, version });
        publishStatus();
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
      readSettings(await host.call<SettingsRecord>("arco_get_settings", {})),
  });
  useEffect(() => () => controller.flush(), [controller]);
  return {
    query,
    ...status,
    update: controller.update,
    schedule: controller.schedule,
    retry: controller.retry,
  };
}
