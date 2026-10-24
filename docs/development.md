# Development guide

Arco uses one npm package and lockfile. Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution scope and [the architecture](technical-stack.md) for ownership boundaries.

## Setup

Use Node.js `>=24.22.1 <25` and npm. The pinned development version is in `.node-version`.

```sh
npm ci
npm run check
```

Use the fixture environment for ordinary UI and integration work. Real provider access is not needed for the fixture host or browser tests.

## Commands

| Command                  | Purpose                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `npm run typecheck`      | TypeScript checking without emitting files.                                                        |
| `npm run lint`           | ESLint for source, scripts, tests, and build configuration.                                        |
| `npm run format:check`   | Formatting for the files covered by the package script.                                            |
| `npm test`               | Unit and service tests; excludes browser specs. Native credential tests can skip when unavailable. |
| `npm run build`          | Build the UI and production/fixture MCP servers.                                                   |
| `npm run smoke`          | Exercise the built fixture MCP server and packaged metadata.                                       |
| `npm run check:artifact` | Check the production bundle, embedded assets, license, and fixture separation.                     |
| `npm run check`          | Run static checks, unit tests, build, smoke, and artifact checks.                                  |
| `npm run test:browser`   | Playwright interaction tests against the fixture host. Requires an installed Chromium browser.     |
| `npm run dev`            | Build and start the fixture host.                                                                  |
| `npm run dev:fixture`    | Start the fixture host using an existing build.                                                    |

For Markdown outside the package formatting script's scope, run `npx --no-install prettier --check '**/*.md'` from the repository root. If Chromium is missing, `npx --no-install playwright install chromium` downloads the browser required by the Playwright configuration.

## Fixture preview

```sh
npm run build
npm run dev:fixture
```

Open the printed loopback URL, normally `http://127.0.0.1:4174`. The mock host talks to `dist/dev/server.mjs` through stdio and refuses a production server. It displays fictional GitHub and Linear issues and records host events for inspection.

To inspect loading transitions:

```sh
ARCO_DEV_TOOL_DELAY_MS=2000 npm run dev:fixture
```

The allowed delay is 0–5000 ms. `ARCO_DEV_PORT` overrides the loopback port. These are development controls, not production plugin settings. Rebuild after source changes; the fixture command does not provide hot reload.

## Repository map

| Path           | Responsibility                                                                              |
| -------------- | ------------------------------------------------------------------------------------------- |
| `src/server/`  | MCP composition, provider services, authorization, writes, and local persistence.           |
| `src/shared/`  | Shared validation schemas, issue references, and state contracts.                           |
| `src/ui/`      | Embedded React interface, host bridge, drafts, and context sharing.                         |
| `plugin/`      | Portable and compatibility manifests, MCP startup configuration, icons, and bundled skills. |
| `scripts/`     | Build, artifact checks, fixture host, and explicit live-validation tools.                   |
| `tests/`       | Unit, service, and Playwright tests; mock host bridge.                                      |
| `experiments/` | Isolated historical probes, separate from the product package.                              |
| `docs/`        | User/developer guides and dated validation records.                                         |

## Build outputs and licensing

`dist/plugin/` contains the production Node ESM server, a self-contained HTML interface, manifests, skills, icons, the MIT `LICENSE`, third-party notices, and native keyring packages for the build platform. `runtime-platform.json` records that platform and architecture. `dist/dev/` contains the fixture server and UI. Generated output is ignored by Git.

Build separately on each target platform. The package is not a standalone Node executable and does not bundle Node or the GitHub CLI. Keep dependency notices intact when redistributing artifacts.

## Verification boundaries

Unit/service tests establish bounded behavior under their mocks. Browser tests establish interaction with the mock MCP Apps host. Build and artifact checks establish packaging properties. Native credential tests establish OS-store behavior only when they actually run. None of these alone proves actual Codex desktop rendering or live provider writes.

After manual installation, `node scripts/validate-plugin-host.mjs` can check discovery and read-oriented startup using the public app-server protocol. It starts an ephemeral thread and checks an existing installed plugin; it does not verify desktop rendering. Some checks intentionally expect the current host's missing workspace-root context, so inspect the script before using it with a different host version.

Live scripts under `scripts/validate-*` can create, update, or remove provider records. Do not run them as a general smoke test. Use dedicated resources and explicit write authorization; inspect each script's arguments, cleanup behavior, and prerequisites first. The GitHub round-trip entry point is:

```sh
npm run test:live -- --repo owner/dedicated-validation-repo --write
```

That script expects `bug` and `documentation` labels and records progress under `test-results/`. It creates a dedicated issue, exercises it, and attempts to close it. A failure still requires checking the recorded issue and cleanup state.

When recording results, include the revision, environment, command, outcome, skipped checks, and remaining native/host limitations. See [implementation status](implementation-status.md) and [platform validation](platform-validation.md).
