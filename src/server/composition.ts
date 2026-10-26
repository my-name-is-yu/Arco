import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubService } from "../shared/contracts";
import type { LinearService } from "../shared/linear";
import { createFixtureService } from "./fixture";
import { createGitHubService } from "./github";
import { createGitHubAuthSession } from "./github/auth-session";
import { credentialIdentity } from "./github/credential-identity";
import { createGitHubOperations } from "./github-operations";
import { createFixtureGitHubOperations } from "./github-operations-fixture";
import {
  LINEAR_FIXTURE_SCOPE,
  createLinearFixtureService,
} from "./linear/fixture";
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
  const authSession = createGitHubAuthSession(credentialIdentity);
  const service = createGitHubService({ authSession });
  return {
    service,
    linearService: createLinearService(),
    operations: createGitHubOperations({ service, authSession }),
    stateStore: createStateStore(),
    fixture: false,
    cleanup() {},
  };
}

export async function createFixtureBackend(): Promise<ArcoBackend> {
  const directory = await mkdtemp(join(tmpdir(), "arco-fixture-state-"));
  const service = createFixtureService();
  const stateStore = createStateStore(directory);
  // Routine fixtures represent an explicitly saved team. First-run tests clear it.
  await stateStore.updateSettings({
    expectedRevision: 0,
    patch: { activeLinearTeam: LINEAR_FIXTURE_SCOPE.teamId },
  });
  return {
    service,
    linearService: createLinearFixtureService(),
    operations: createFixtureGitHubOperations({ service }),
    stateStore,
    fixture: true,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
