import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFixtureBackend } from "../src/server/composition";
import { createArcoServer } from "../src/server/mcp";
import { createStateStore } from "../src/server/state";
import { defaultSettings } from "../src/shared/state";
import { runtimeAttachment } from "../src/ui/context-attachment";
import { readSharedContext } from "../src/ui/shared-context";

describe("Symphony integration boundaries", () => {
  it("opens explicit and saved Symphony views without contacting issue providers", async () => {
    const backend = await createFixtureBackend();
    const github = vi.spyOn(backend.service, "connection");
    const linear = vi.spyOn(backend.linearService, "call");
    const runtime = vi.spyOn(backend.symphonyService, "getState");
    const server = createArcoServer(backend);
    const client = new Client({ name: "Symphony integration", version: "1" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = (await client.listTools()).tools;
      expect(runtime).not.toHaveBeenCalled();
      for (const name of [
        "arco_symphony_state",
        "arco_symphony_issue",
        "arco_symphony_test_connection",
      ]) {
        expect(
          tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint,
        ).toBe(true);
      }
      expect(
        tools.find((tool) => tool.name === "arco_symphony_test_connection")
          ?._meta?.ui,
      ).toEqual({ visibility: ["app"] });
      const opened = await client.callTool({
        name: "arco_open",
        arguments: {
          source: "symphony",
          symphony: {
            connectionId: "fixture-symphony-linear",
            issueIdentifier: "YU-42",
          },
        },
      });
      expect(opened.isError).not.toBe(true);
      expect(
        (opened.structuredContent as Record<string, unknown>)?.launch,
      ).toMatchObject({
        source: "symphony",
        symphony: {
          connectionId: "fixture-symphony-linear",
          issueIdentifier: "YU-42",
        },
      });
      const current = await backend.stateStore.readSettings();
      await backend.stateStore.updateSettings({
        expectedRevision: current.revision,
        patch: { activeSource: "symphony" },
      });
      const restored = await client.callTool({
        name: "arco_open",
        arguments: {},
      });
      expect(
        (restored.structuredContent as Record<string, unknown>)?.launch,
      ).toMatchObject({
        source: "symphony",
      });
      expect(github).not.toHaveBeenCalled();
      expect(linear).not.toHaveBeenCalled();
      expect(runtime).not.toHaveBeenCalled();
      const state = await client.callTool({
        name: "arco_symphony_state",
        arguments: { connectionId: "fixture-symphony-linear" },
      });
      expect(state.isError).not.toBe(true);
      expect(
        (state.structuredContent as Record<string, unknown>)?.rows,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueIdentifier: "YU-42",
            runtimeStatus: "blocked",
          }),
        ]),
      );
      expect(runtime).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await server.close();
      backend.cleanup();
    }
  });

  it("reads pre-Symphony settings without rewriting data or losing preferences", async () => {
    const directory = await mkdtemp(join(tmpdir(), "arco-symphony-legacy-"));
    try {
      const legacy: Record<string, unknown> = {
        ...defaultSettings,
        activeSource: "linear",
        characterShortcutsEnabled: false,
      };
      delete legacy.symphonyConnections;
      delete legacy.activeSymphonyConnectionId;
      delete legacy.symphonyLayout;
      const original = JSON.stringify({ revision: 7, settings: legacy });
      const file = join(directory, "settings.json");
      await writeFile(file, original);
      const record = await createStateStore(directory).readSettings();
      expect(record).toMatchObject({
        revision: 7,
        settings: {
          ...legacy,
          symphonyConnections: [],
          activeSymphonyConnectionId: null,
          symphonyLayout: "board",
        },
      });
      expect(await readFile(file, "utf8")).toBe(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("shares only an explicit runtime snapshot without impersonating an issue or annotation", () => {
    const payload = runtimeAttachment({
      connectionId: "local",
      connectionName: "Local Symphony",
      issueIdentifier: "GH-42",
      observedAt: "2026-11-01T00:00:00Z",
      runtimeStatus: "blocked",
      lastEvent: "input_required",
      lastMessage: "Choose a repository",
      error: null,
      turnCount: 1,
      retryDueAt: null,
    });
    expect(payload.content).toHaveLength(1);
    expect(payload.content[0]?.text).toContain("Choose a repository");
    expect(payload.structuredContent).not.toHaveProperty("arcoSharedIssue");
    expect(readSharedContext(payload.structuredContent)).toEqual({
      issue: null,
      annotations: null,
      snapshotId: null,
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /workspacePath|workerHost|baseUrl/,
    );
  });
});
