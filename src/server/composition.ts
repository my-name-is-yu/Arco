import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubService } from "../shared/contracts";
import type { LinearService } from "../shared/linear";
import { createFixtureService } from "./fixture";
import { createGitHubService } from "./github";
import { createGitHubOperations } from "./github-operations";
import { createFixtureGitHubOperations } from "./github-operations-fixture";
import { createLinearFixtureService } from "./linear/fixture";
import { createLinearService } from "./linear/service";
import { createStateStore } from "./state";

export interface ArcoBackend {
  service: GitHubService;
  linearService: LinearService;
  operations: ReturnType<typeof createGitHubOperations>;
  stateStore: ReturnType<typeof createStateStore>;
  fixture: boolean;
  cleanup(): void;
}

export function createLiveBackend(): ArcoBackend {
  const service = createGitHubService({
    defaultRepo: process.env.ARCO_GITHUB_REPO,
  });
  return {
    service,
    linearService: createLinearService(),
    operations: createGitHubOperations({ service }),
    stateStore: createStateStore(),
    fixture: false,
    cleanup() {},
  };
}

export async function createFixtureBackend(): Promise<ArcoBackend> {
  const directory = await mkdtemp(join(tmpdir(), "arco-fixture-state-"));
  const service = createFixtureService();
  return {
    service,
    linearService: createLinearFixtureService(),
    operations: createFixtureGitHubOperations({ service }),
    stateStore: createStateStore(directory),
    fixture: true,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
