import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ArcoHost } from "../src/shared/contracts";
import {
  defaultSettings,
  settingsSchema,
  type SettingsRecord,
} from "../src/shared/state";
import { settingsController } from "../src/ui/useSettings";
import { rememberSetting } from "../src/ui/settings-retention";

function fixture() {
  let saved: SettingsRecord = {
    revision: 0,
    settings: structuredClone(defaultSettings),
  };
  let fail = true;
  const call = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "arco_get_settings") return saved;
    if (fail) throw new Error("Disk unavailable");
    saved = {
      revision: saved.revision + 1,
      settings: settingsSchema.parse({
        ...saved.settings,
        ...(args.patch as object),
      }),
    };
    return saved;
  });
  const host = { call } as unknown as ArcoHost;
  return {
    controller: settingsController(host, new QueryClient()),
    saved: () => saved,
    recover: () => {
      fail = false;
    },
  };
}
const filter = {
  query: "preserve",
  state: "open" as const,
  sort: "updated" as const,
  order: "desc" as const,
};

describe("settings recovery", () => {
  it("rejects malformed saved settings before writing and keeps the preference for explicit retry", async () => {
    let malformed = true;
    const record = { revision: 0, settings: structuredClone(defaultSettings) };
    const call = vi.fn(async (name: string) =>
      name === "arco_get_settings" && malformed
        ? { revision: "private-schema-value", settings: {} }
        : record,
    );
    const controller = settingsController(
      { call } as unknown as ArcoHost,
      new QueryClient(),
    );
    controller.update("source", () => ({ activeSource: "linear" }));
    await vi.waitFor(() => expect(controller.get().pending).toBe(false));
    expect(controller.get().error).toBe(
      "Could not read the saved settings. Reopen Arco and try again.",
    );
    expect(call).toHaveBeenCalledExactlyOnceWith("arco_get_settings", {});
    malformed = false;
    controller.retry();
    await vi.waitFor(() => expect(controller.get().pending).toBe(false));
    expect(call).toHaveBeenLastCalledWith("arco_update_settings", {
      expectedRevision: 0,
      patch: { activeSource: "linear" },
    });
    expect(controller.get().error).toBeNull();
  });

  it("retries the failed filter after an unrelated successful scope change", async () => {
    const { controller, recover, saved } = fixture();
    controller.update("github:yu/Arco", (latest) => ({
      githubFilters: { ...latest.githubFilters, "yu/Arco": filter },
    }));
    await vi.waitFor(() =>
      expect(controller.get().error).toBe("Disk unavailable"),
    );
    recover();
    controller.update("github:scope", () => ({ activeGithubRepo: "yu/Arco" }));
    await vi.waitFor(() => expect(controller.get().pending).toBe(false));
    expect(controller.get().error).toBe("Disk unavailable");
    controller.retry();
    await vi.waitFor(() =>
      expect(controller.get()).toEqual({ pending: false, error: null }),
    );
    expect(saved().settings.githubFilters["yu/Arco"]).toEqual(filter);
    expect(saved().settings.activeGithubRepo).toBe("yu/Arco");
  });

  it("does not replay a failed preference after the user replaces that intent", async () => {
    const { controller, recover, saved } = fixture();
    controller.update("source", () => ({ activeSource: "linear" }));
    await vi.waitFor(() => expect(controller.get().error).toBeTruthy());
    recover();
    controller.update("source", () => ({ activeSource: "github" }));
    await vi.waitFor(() => expect(controller.get().pending).toBe(false));
    controller.retry();
    expect(saved().settings.activeSource).toBe("github");
    expect(controller.get().error).toBeNull();
  });

  it("keeps the newest edit when a failed debounced filter is replaced", async () => {
    const { controller, recover, saved } = fixture();
    controller.schedule("github:yu/Arco", () => ({
      githubFilters: { "yu/Arco": filter },
    }));
    controller.flush();
    await vi.waitFor(() => expect(controller.get().error).toBeTruthy());
    recover();
    controller.schedule("github:yu/Arco", () => ({
      githubFilters: { "yu/Arco": { ...filter, query: "latest" } },
    }));
    controller.retry();
    controller.flush();
    await vi.waitFor(() => expect(controller.get().pending).toBe(false));
    expect(saved().settings.githubFilters["yu/Arco"].query).toBe("latest");
  });
});

describe("bounded settings history", () => {
  it("refreshes recency and evicts old filters before reaching the schema limit", () => {
    const existing = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`yu/repo${index}`, filter]),
    );
    const refreshed = rememberSetting(existing, "yu/repo0", filter);
    const next = rememberSetting(refreshed, "yu/new", filter);
    expect(next["yu/repo0"]).toEqual(filter);
    expect(next["yu/repo1"]).toBeUndefined();
    expect(Object.keys(next)).toHaveLength(100);
    expect(
      settingsSchema.safeParse({ ...defaultSettings, githubFilters: next })
        .success,
    ).toBe(true);
    const linearFilters = Object.fromEntries(
      Object.entries(next).map(([key]) => [
        key,
        {
          query: "",
          stateId: "",
          assigneeId: "",
          labelId: "",
          projectId: "",
          order: "updatedAt" as const,
        },
      ]),
    );
    expect(
      settingsSchema.safeParse({ ...defaultSettings, linearFilters }).success,
    ).toBe(true);
  });
});
