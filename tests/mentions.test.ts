import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMentionSearch, linearResourceUri } from "../src/server/mentions";
import { createFixtureService } from "../src/server/fixture";
import {
  createLinearFixtureService,
  LINEAR_FIXTURE_SCOPE,
} from "../src/server/linear/fixture";
import { createStateStore } from "../src/server/state";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "arco-mentions-"));
  directories.push(directory);
  const state = createStateStore(directory);
  const github = createFixtureService();
  const linear = createLinearFixtureService();
  return {
    state,
    github,
    linear,
    search: createMentionSearch(github, linear, state),
  };
}

describe("native Issue mention resources", () => {
  it("requires an explicit or saved GitHub repository instead of choosing an implicit default", async () => {
    const { github, search } = await setup();
    const list = vi.spyOn(github, "list");
    const connection = vi.spyOn(github, "connection");
    await expect(search({ query: "workflow" })).rejects.toThrow(
      "Specify repo:",
    );
    expect(list).not.toHaveBeenCalled();
    expect(connection).not.toHaveBeenCalled();
  });
  it("requires a Linear team choice even if only one team is available", async () => {
    const { linear, search } = await setup();
    const call = vi.spyOn(linear, "call");
    await expect(search({ query: "source:linear workflow" })).rejects.toThrow(
      "Choose a Linear team",
    );
    expect(call.mock.calls.map(([name]) => name)).toEqual(["linear_scopes"]);
  });
  it("uses an explicit repository and retains the GitHub source identity", async () => {
    const { search } = await setup();
    const result = await search({ query: "repo:yu/Arco" });
    expect(result.items.length).toBeGreaterThan(1);
    expect(
      result.items.every(
        (item) =>
          item.type === "resource" &&
          item.resourceUri.startsWith("issue://github/yu/Arco/"),
      ),
    ).toBe(true);
  });
  it("uses the saved Linear scope without making a GitHub connection request", async () => {
    const { state, github, search } = await setup();
    const connection = vi.spyOn(github, "connection");
    await state.updateSettings({
      expectedRevision: 0,
      patch: {
        activeSource: "linear",
        activeLinearTeam: LINEAR_FIXTURE_SCOPE.teamId,
      },
    });
    const result = await search({ query: "workflow" });
    expect(result.items[0]).toMatchObject({
      resourceUri: linearResourceUri({
        ...LINEAR_FIXTURE_SCOPE,
        issueId: "fixture-linear-42",
      }),
      title: "YU-42 Keep Linear workflow states intact",
    });
    expect(connection).not.toHaveBeenCalled();
  });
  it("supports explicit Linear team keys and refuses an unknown team without source fallback", async () => {
    const { github, search } = await setup();
    const connection = vi.spyOn(github, "connection");
    expect(
      (await search({ query: "source:linear team:YU workflow" })).items,
    ).toHaveLength(1);
    await expect(search({ query: "source:linear team:other" })).rejects.toThrow(
      "Choose a Linear team",
    );
    expect(connection).not.toHaveBeenCalled();
  });
  it("rejects mixed source scopes and preserves ordinary words beginning with linear", async () => {
    const { github, search } = await setup();
    await expect(
      search({ query: "source:linear repo:yu/Arco" }),
    ).rejects.toThrow("one source");
    const list = vi.spyOn(github, "list");
    await search({ query: "repo:yu/Arco linearization" });
    expect(list.mock.calls[0][0].query).toBe("linearization");
  });
  it("encodes each native Linear reference segment independently", () => {
    expect(
      linearResourceUri({
        connectionId: "account/a",
        workspaceId: "workspace",
        teamId: "team",
        issueId: "issue#1",
      }),
    ).toBe("issue://linear/account%2Fa/workspace/team/issue%231");
  });
  it("requires a team when a saved team is unavailable or multiple initial teams exist", async () => {
    const { state, linear, search } = await setup();
    await state.updateSettings({
      expectedRevision: 0,
      patch: { activeSource: "linear", activeLinearTeam: "removed-team" },
    });
    await expect(search({ query: "workflow" })).rejects.toThrow(
      "Choose a Linear team",
    );
    await state.updateSettings({
      expectedRevision: 1,
      patch: { activeLinearTeam: null },
    });
    vi.spyOn(linear, "call").mockResolvedValue({
      workspace: { id: "workspace" },
      teams: [
        { id: "one", key: "ONE" },
        { id: "two", key: "TWO" },
      ],
    });
    await expect(search({ query: "workflow" })).rejects.toThrow(
      "Choose a Linear team",
    );
  });
});
