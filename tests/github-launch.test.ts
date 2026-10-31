import { afterEach, describe, expect, it, vi } from "vitest";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createGitHubTransport,
  createGitHubWriteGuard,
} from "../src/server/github/transport";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")(
  "GitHub CLI startup failures",
  () => {
    it.each([
      { failure: "missing executable", exists: false, code: "missing-cli" },
      { failure: "permission denied", exists: true, code: "unavailable" },
    ])(
      "retries the same request after $failure without a dispatch",
      async ({ exists, code }) => {
        const directory = await mkdtemp(join(tmpdir(), "arco-gh-launch-test-"));
        directories.push(directory);
        const executable = join(directory, "gh");
        const marker = join(directory, "executions");
        const stub = `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(marker)}, "executed");
process.stdout.write(JSON.stringify({ data: { save: { id: "saved" } } }));
`;
        if (exists) await writeFile(executable, stub, { mode: 0o600 });
        vi.stubEnv("PATH", directory);
        const transport = createGitHubTransport({ policy: "extended" });
        const once = createGitHubWriteGuard<unknown>(
          async () => "test-credential",
        );
        const write = () => transport.mutate("mutation Save { save }", {});
        const failure = await once("startup-retry", {}, write).catch(
          (error) => error,
        );
        await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
        expect(failure).toMatchObject({
          code,
          message: exists
            ? "Unable to start GitHub CLI."
            : "GitHub CLI was not found. Install gh using the instructions at cli.github.com.",
        });
        if (!exists) await writeFile(executable, stub, { mode: 0o600 });
        await chmod(executable, 0o700);
        await expect(once("startup-retry", {}, write)).resolves.toEqual({
          data: { save: { id: "saved" } },
        });
        expect(await readFile(marker, "utf8")).toBe("executed");
      },
    );
  },
);
