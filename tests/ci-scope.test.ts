import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/ci-scope.mjs");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function scope(name: string | undefined, includeOutput = true) {
  const root = mkdtempSync(join(tmpdir(), "arco-ci-scope-"));
  roots.push(root);
  const outputFile = join(root, "output.txt");
  writeFileSync(outputFile, "existing=retained\n");
  const run = () =>
    execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: name,
        GITHUB_OUTPUT: includeOutput ? outputFile : undefined,
      },
    });
  return { run, output: () => readFileSync(outputFile, "utf8") };
}

describe("CI validation scope", () => {
  it.each(["push", "pull_request"])(
    "keeps %s lightweight without inspecting changed paths or Git history",
    (name) => {
      const fixture = scope(name);
      expect(JSON.parse(fixture.run())).toEqual({ mode: "smoke" });
      expect(fixture.output()).toBe("existing=retained\nmode=smoke\n");
    },
  );

  it("runs the full browser suite when explicitly dispatched before release", () => {
    const fixture = scope("workflow_dispatch");
    expect(JSON.parse(fixture.run())).toEqual({ mode: "full" });
    expect(fixture.output()).toBe("existing=retained\nmode=full\n");
  });

  it.each(["schedule", "release", "unknown"])(
    "rejects unsupported %s events without writing a validation scope",
    (name) => {
      const fixture = scope(name);
      expect(fixture.run).toThrow(/Unsupported CI event/);
      expect(fixture.output()).toBe("existing=retained\n");
    },
  );

  it.each([
    [undefined, true],
    ["push", false],
  ] as const)("rejects missing CI context (%s, output: %s)", (name, output) => {
    expect(scope(name, output).run).toThrow(
      /requires the event name and output/,
    );
  });
});
