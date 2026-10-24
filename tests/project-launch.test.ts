import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conversationLaunchKey,
  githubRepositoryFromRemote,
  resolveProjectLaunch,
} from "../src/server/launch";
import {
  launchContextSchema,
  personalLaunchContext,
} from "../src/shared/launch";

const execute = promisify(execFile);
const directories: string[] = [];
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), "arco-project-launch-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("project repository resolution", () => {
  it("keys an explicit repository choice by chat without storing the chat ID", () => {
    const first = conversationLaunchKey("chat-one");
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(conversationLaunchKey("chat-one")).toBe(first);
    expect(conversationLaunchKey("chat-two")).not.toBe(first);
    expect(first).not.toContain("chat-one");
    for (const value of [undefined, null, 1, "", "x".repeat(513)])
      expect(conversationLaunchKey(value)).toBeNull();
  });

  it.each([
    "https://github.com/yu/Arco.git",
    "https://credential@github.com/yu/Arco.git",
    "git@github.com:yu/Arco.git",
    "ssh://git@github.com/yu/Arco.git",
    "git://github.com/yu/Arco",
    "https://github.com/yu/Arco/",
  ])("extracts only repository identity from %s", (remote) => {
    expect(githubRepositoryFromRemote(remote)).toBe("yu/Arco");
  });

  it.each([
    "https://github.example.com/yu/Arco",
    "https://github.com.evil.example/yu/Arco",
    "https://github.com/yu/Arco/issues/1",
    "https://github.com/yu/Arco?token=credential",
    "file:///yu/Arco",
    "../Arco",
    "git@github.com:../Arco.git",
  ])("does not guess a GitHub repository from %s", (remote) => {
    expect(githubRepositoryFromRemote(remote)).toBeNull();
  });

  it("keeps a personal launch independent of any project", () => {
    expect(launchContextSchema.parse(personalLaunchContext)).toEqual({
      view: "personal",
      repo: null,
      projectKey: null,
      projectName: null,
      candidates: [],
      reason: "personal",
    });
    expect(
      launchContextSchema.safeParse({
        ...personalLaunchContext,
        projectKey: "/private/workspace",
      }).success,
    ).toBe(false);
  });

  it("reads actual local Git remotes without returning credentials or paths", async () => {
    const directory = await temporary();
    await execute("git", ["init", "--quiet", directory]);
    await execute("git", [
      "-C",
      directory,
      "config",
      "remote.origin.url",
      "https://credential@github.com/yu/Arco.git",
    ]);
    await execute("git", [
      "-C",
      directory,
      "config",
      "remote.mirror.url",
      "git@github.com:yu/arco.git",
    ]);
    const launch = await resolveProjectLaunch({
      listRoots: async () => [{ uri: pathToFileURL(directory).href }],
    });
    expect(launch).toMatchObject({
      view: "project",
      repo: expect.stringMatching(/^yu\/arco$/i),
      projectKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      projectName: expect.stringMatching(/^arco-project-launch-/),
      reason: "detected",
    });
    expect(launch.candidates).toHaveLength(1);
    expect(JSON.stringify(launch)).not.toContain("credential");
    expect(JSON.stringify(launch)).not.toContain(directory);
    expect(launchContextSchema.safeParse(launch).success).toBe(true);
  });

  it("recognizes an actual non-Git folder as having no GitHub repository", async () => {
    const directory = await temporary();
    const launch = await resolveProjectLaunch({
      listRoots: async () => [{ uri: pathToFileURL(directory).href }],
    });
    expect(launch.repo).toBeNull();
    expect(launch.reason).toBe("no-github-repository");
    expect(launch.projectKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("recognizes an actual Git repository with no matching remotes", async () => {
    const directory = await temporary();
    await execute("git", ["init", "--quiet", directory]);
    const launch = await resolveProjectLaunch({
      listRoots: async () => [{ uri: pathToFileURL(directory).href }],
    });
    expect(launch.repo).toBeNull();
    expect(launch.reason).toBe("no-github-repository");
    expect(launch.projectKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps an unreadable Git config unresolved without exposing its error", async () => {
    const directory = await temporary();
    await execute("git", ["init", "--quiet", directory]);
    await writeFile(join(directory, ".git", "config"), "[malformed-secret\n");
    const launch = await resolveProjectLaunch({
      listRoots: async () => [{ uri: pathToFileURL(directory).href }],
    });
    expect(launch.repo).toBeNull();
    expect(launch.reason).toBe("unavailable");
    expect(launch.projectKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(launch)).not.toContain("malformed-secret");
    expect(JSON.stringify(launch)).not.toContain(directory);
  });

  it("resolves the advertised roots without another directory source", async () => {
    const root = await temporary();
    const readRemotes = vi.fn(async () => ["git@github.com:yu/Project.git"]);
    const launch = await resolveProjectLaunch({
      listRoots: async () => [{ uri: pathToFileURL(root).href }],
      readRemotes,
    });
    expect(launch.repo).toBe("yu/Project");
    expect(readRemotes).toHaveBeenCalledTimes(1);
    expect(readRemotes.mock.calls[0]).toEqual([await realpath(root)]);
  });

  it("leaves different origin and upstream repositories ambiguous", async () => {
    const directory = await temporary();
    const launch = await resolveProjectLaunch({
      listRoots: async () => [{ uri: pathToFileURL(directory).href }],
      readRemotes: async () => [
        "git@github.com:yu/Fork.git",
        "https://github.com/org/Upstream.git",
      ],
    });
    expect(launch.repo).toBeNull();
    expect(launch.reason).toBe("ambiguous");
    expect(launch.candidates).toEqual(["org/Upstream", "yu/Fork"]);
    expect(launch.projectKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses all roots and creates an order-independent project key", async () => {
    const directory = await temporary();
    const first = join(directory, "first");
    const second = join(directory, "second");
    await Promise.all([mkdir(first), mkdir(second)]);
    const roots = [first, second].map((path) => ({
      uri: pathToFileURL(path).href,
    }));
    const readRemotes = async (path: string) => [
      `git@github.com:yu/${path.endsWith("first") ? "First" : "Second"}.git`,
    ];
    const initial = await resolveProjectLaunch({
      listRoots: async () => roots,
      readRemotes,
    });
    const reversed = await resolveProjectLaunch({
      listRoots: async () => [...roots].reverse(),
      readRemotes,
    });
    expect(initial.reason).toBe("ambiguous");
    expect(initial.projectKey).toBe(reversed.projectKey);
    expect(initial.projectName).toBe("2 folders");
  });

  it("does not auto-select a successful root when another root cannot be read", async () => {
    const directory = await temporary();
    const first = join(directory, "first");
    const second = join(directory, "second");
    await Promise.all([mkdir(first), mkdir(second)]);
    const listRoots = async () =>
      [first, second].map((path) => ({ uri: pathToFileURL(path).href }));
    const complete = await resolveProjectLaunch({
      listRoots,
      readRemotes: async () => ["git@github.com:yu/Project.git"],
    });
    const partial = await resolveProjectLaunch({
      listRoots,
      readRemotes: async (path) => {
        if (path.endsWith("second"))
          throw new Error("Timeout with credential-bearing error");
        return ["git@github.com:yu/Project.git"];
      },
    });
    expect(partial).toEqual({
      view: "project",
      repo: null,
      projectKey: complete.projectKey,
      projectName: "2 folders",
      candidates: [],
      reason: "unavailable",
    });
  });

  it("keeps a canonical project key when a folder is opened through a symlink", async () => {
    const directory = await temporary();
    const root = join(directory, "root");
    const link = join(directory, "link");
    await mkdir(root);
    await symlink(root, link);
    const readRemotes = async () => [];
    const direct = await resolveProjectLaunch({
      listRoots: async () => [{ uri: pathToFileURL(root).href }],
      readRemotes,
    });
    const linked = await resolveProjectLaunch({
      listRoots: async () => [{ uri: pathToFileURL(link).href }],
      readRemotes,
    });
    expect(linked.projectKey).toBe(direct.projectKey);
    expect(linked.projectName).toBe("root");
    expect(linked.reason).toBe("no-github-repository");
  });

  it("does not resolve from process cwd when no client workspace is supplied", async () => {
    const readRemotes = vi.fn(async () => ["git@github.com:yu/Wrong.git"]);
    const launch = await resolveProjectLaunch({ readRemotes });
    expect(launch.reason).toBe("unavailable");
    expect(launch.projectKey).toBeNull();
    expect(readRemotes).not.toHaveBeenCalled();
  });

  it("leaves the project unresolved when the client supplies no roots", async () => {
    const readRemotes = vi.fn(async () => ["git@github.com:yu/Project.git"]);
    const launch = await resolveProjectLaunch({
      listRoots: async () => [],
      readRemotes,
    });
    expect(launch.reason).toBe("unavailable");
    expect(launch.repo).toBeNull();
    expect(readRemotes).not.toHaveBeenCalled();
  });

  it("does not replace failed or non-file advertised roots with cwd", async () => {
    const directory = await temporary();
    const readRemotes = vi.fn(async () => ["git@github.com:yu/Wrong.git"]);
    for (const listRoots of [
      async () => {
        throw new Error("Unavailable");
      },
      async () => [{ uri: "https://example.com/project" }],
      async () => [{ uri: pathToFileURL(join(directory, "missing")).href }],
    ]) {
      const launch = await resolveProjectLaunch({
        listRoots,
        readRemotes,
      });
      expect(launch.reason).toBe("unavailable");
      expect(launch.repo).toBeNull();
      expect(launch.projectKey).toBeNull();
    }
    expect(readRemotes).not.toHaveBeenCalled();
  });
});
