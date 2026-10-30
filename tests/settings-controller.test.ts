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
  it("persists disabled character shortcuts alongside queued source changes", async () => {
    const source = fixture();
    source.recover();
    source.controller.update("keyboard-shortcuts", () => ({
      characterShortcutsEnabled: false,
    }));
    source.controller.update("source", () => ({ activeSource: "linear" }));
    await vi.waitFor(() =>
      expect(source.controller.get()).toEqual({ pending: false, error: null }),
    );
    expect(source.saved().settings.characterShortcutsEnabled).toBe(false);
    expect(source.saved().settings.activeSource).toBe("linear");
  });

  it("serializes settings writes per host across a source change", async () => {
    let saved: SettingsRecord = {
      revision: 0,
      settings: structuredClone(defaultSettings),
    };
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const call = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "arco_get_settings") return structuredClone(saved);
      if (saved.revision === 0) await pending;
      if (args.expectedRevision !== saved.revision)
        throw new Error("Stale settings revision");
      saved = {
        revision: saved.revision + 1,
        settings: settingsSchema.parse({
          ...saved.settings,
          ...(args.patch as object),
        }),
      };
      return structuredClone(saved);
    });
    const host = { call } as unknown as ArcoHost;
    const client = new QueryClient();
    const outgoing = settingsController(host, client);
    const incoming = settingsController(host, client);
    outgoing.schedule("github:yu/Arco", (latest) => ({
      githubFilters: { ...latest.githubFilters, "yu/Arco": filter },
    }));
    outgoing.flush();
    incoming.update("source", () => ({ activeSource: "linear" }));
    try {
      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
      expect(incoming.get().pending).toBe(true);
      const other = fixture();
      other.recover();
      other.controller.update("source", () => ({ activeSource: "linear" }));
      await vi.waitFor(() =>
        expect(other.controller.get().pending).toBe(false),
      );
      expect(other.saved().settings.activeSource).toBe("linear");
    } finally {
      release();
    }
    await vi.waitFor(() =>
      expect(incoming.get()).toEqual({ pending: false, error: null }),
    );
    expect(saved.revision).toBe(2);
    expect(saved.settings.githubFilters["yu/Arco"]).toEqual(filter);
    expect(saved.settings.activeSource).toBe("linear");
  });

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
    const source = fixture();
    source.controller.update("github:yu/Arco", (latest) => ({
      githubFilters: { ...latest.githubFilters, "yu/Arco": filter },
    }));
    await vi.waitFor(() =>
      expect(source.controller.get().error).toBe("Disk unavailable"),
    );
    source.recover();
    source.controller.update("github:scope", () => ({
      activeGithubRepo: "yu/Arco",
    }));
    await vi.waitFor(() => expect(source.controller.get().pending).toBe(false));
    expect(source.controller.get().error).toBe("Disk unavailable");
    source.controller.retry();
    await vi.waitFor(() =>
      expect(source.controller.get()).toEqual({ pending: false, error: null }),
    );
    expect(source.saved().settings.githubFilters["yu/Arco"]).toEqual(filter);
    expect(source.saved().settings.activeGithubRepo).toBe("yu/Arco");
  });

  it("does not replay a failed preference after the user replaces that intent", async () => {
    const source = fixture();
    source.controller.update("source", () => ({ activeSource: "linear" }));
    await vi.waitFor(() => expect(source.controller.get().error).toBeTruthy());
    source.recover();
    source.controller.update("source", () => ({ activeSource: "github" }));
    await vi.waitFor(() => expect(source.controller.get().pending).toBe(false));
    source.controller.retry();
    expect(source.saved().settings.activeSource).toBe("github");
    expect(source.controller.get().error).toBeNull();
  });

  it("keeps the newest edit when a failed debounced filter is replaced", async () => {
    const source = fixture();
    source.controller.schedule("github:yu/Arco", () => ({
      githubFilters: { "yu/Arco": filter },
    }));
    source.controller.flush();
    await vi.waitFor(() => expect(source.controller.get().error).toBeTruthy());
    source.recover();
    source.controller.schedule("github:yu/Arco", () => ({
      githubFilters: { "yu/Arco": { ...filter, query: "latest" } },
    }));
    source.controller.retry();
    source.controller.flush();
    await vi.waitFor(() => expect(source.controller.get().pending).toBe(false));
    expect(source.saved().settings.githubFilters["yu/Arco"].query).toBe(
      "latest",
    );
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
