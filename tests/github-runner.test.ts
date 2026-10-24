import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  createGitHubTransport,
  createGitHubWriteGuard,
} from "../src/server/github/transport";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

function cliResponse(value: unknown, stderr: string, exitCode: number) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  queueMicrotask(() => {
    child.stdout.emit("data", JSON.stringify(value));
    child.stderr.emit("data", stderr);
    child.emit("close", exitCode);
  });
  return child as unknown as ReturnType<typeof spawn>;
}

describe("GitHub CLI mutation outcomes", () => {
  it.each([
    ["RATE_LIMITED", "GraphQL: API rate limit exceeded"],
    ["FORBIDDEN", "GraphQL: Resource not accessible (HTTP 403)"],
  ])(
    "retains a partial mutation despite a nonzero CLI exit with %s",
    async (type, stderr) => {
      const launch = vi.mocked(spawn).mockImplementation(() =>
        cliResponse(
          {
            data: { save: { id: "saved" } },
            errors: [{ type, message: "private provider detail" }],
          },
          stderr,
          1,
        ),
      );
      launch.mockClear();
      const transport = createGitHubTransport({ policy: "extended" });
      const once = createGitHubWriteGuard<unknown>();
      const write = () => transport.mutate("mutation Save { save }", {});
      for (let attempt = 0; attempt < 2; attempt++)
        await expect(once("partial-result", {}, write)).rejects.toMatchObject({
          code: "uncertain",
          message: expect.not.stringContaining("private provider detail"),
        });
      expect(launch).toHaveBeenCalledOnce();
    },
  );

  it("retries a CLI rate rejection without partial data after it recovers", async () => {
    const launch = vi
      .mocked(spawn)
      .mockImplementationOnce(() =>
        cliResponse(
          { errors: [{ type: "RATE_LIMITED" }] },
          "GraphQL: API rate limit exceeded",
          1,
        ),
      )
      .mockImplementationOnce(() =>
        cliResponse({ data: { save: { id: "saved" } } }, "", 0),
      );
    launch.mockClear();
    const transport = createGitHubTransport({ policy: "extended" });
    const once = createGitHubWriteGuard<unknown>();
    const write = () => transport.mutate("mutation Save { save }", {});
    await expect(once("rate-rejected", {}, write)).rejects.toMatchObject({
      code: "rate-limited",
    });
    await expect(once("rate-rejected", {}, write)).resolves.toEqual({
      data: { save: { id: "saved" } },
    });
    expect(launch).toHaveBeenCalledTimes(2);
  });
});
