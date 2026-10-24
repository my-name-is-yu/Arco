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

| Command                      | Purpose                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run typecheck`          | TypeScript checking without emitting files.                                                        |
| `npm run lint`               | ESLint for source, scripts, tests, and build configuration.                                        |
| `npm run format:check`       | Formatting for the files covered by the package script.                                            |
| `npm run check:docs`         | Check tracked Markdown formatting and repository-local links without modifying files.              |
| `npm test`                   | Unit and service tests; excludes browser specs. Native credential tests can skip when unavailable. |
| `npm run build`              | Build the UI and production/fixture MCP servers.                                                   |
| `npm run smoke`              | Exercise the built fixture MCP server and packaged metadata.                                       |
| `npm run check:artifact`     | Check the production bundle, embedded assets, license, and fixture separation.                     |
| `npm run check`              | Run static/documentation checks, unit tests, build, smoke, and artifact checks.                    |
| `npm run test:browser`       | Playwright interaction tests against the fixture host. Requires an installed Chromium browser.     |
| `npm run test:browser:smoke` | Run only the critical browser cases tagged `@smoke`. Requires a build and Chromium.                |
| `npm run dev`                | Build and start the fixture host.                                                                  |
| `npm run dev:fixture`        | Start the fixture host using an existing build.                                                    |

For Markdown outside the package formatting script's scope, run `npx --no-install prettier --check '**/*.md'` from the repository root. If Chromium is missing, `npx --no-install playwright install chromium` downloads the browser required by the Playwright configuration.

Type checking rejects unused locals and parameters. Keep provider semantics explicit; share interaction mechanics only where both providers need the same behavior. Do not add compatibility routes for retired Arco inputs or storage formats. See [Local data](local-data-boundary.md) for invalid-data handling.

The [fallback policy](fallback-policy.md) fixes the allowed recovery paths. Routine browser fixtures start with an explicitly saved fictional Linear team. First-run scope tests clear that selection and verify that no issue or metadata reads start before a choice.

## Continuous integration

The [Quality workflow](../.github/workflows/quality.yml) runs on pull requests and pushes to `main` that include changes outside the documentation paths below. Documentation-only changes do not start a workflow or report a `Quality checks` job. Code checks use Ubuntu 24.04, the Node.js version in `.node-version`, and `npm ci`. The [scope selector](../scripts/ci-scope.mjs) chooses one of two modes:

| Mode    | When                                                                                     | Checks                                                      |
| ------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `smoke` | Ordinary code, test, or workflow changes                                                 | Complete `npm run check`, then `npm run test:browser:smoke` |
| `full`  | Shared host/storage contracts, dependency/toolchain changes, or an explicitly full event | Complete `npm run check`, then `npm run test:browser`       |

The critical browser suite contains 20 existing cases for both providers: reading/saving, exact targets and selections, annotation removal, drafts, conflict handling, uncertain-write protection, hostile Markdown, invalid settings/cursors, explicit scope, and request/operation limits. The full 173-case suite also covers the broad property, hover, theme/width, and real-time polling matrices. Tag metadata selects the critical cases; their titles and test logic remain the same in the full suite. No browser retries are enabled.

All unit/service tests remain in every code check. The initial hosted run spent about 57 seconds on all non-browser checks, including roughly 16 seconds on unit/service tests; full browser coverage took 12 minutes 18 seconds. Reducing the routine browser scope retains those inexpensive checks.

Full coverage runs nightly at 03:23 JST, on manual dispatch, and when a release or prerelease is published, regardless of documentation path filters. Before publishing a release, manually run the workflow on the candidate revision and require its full result; the publication event is an additional verification, not a publication gate. Dependency sections and engines in `package.json` trigger full coverage, while script-only edits do not. The selector owns the shared-contract path list; unknown paths use code checks, and invalid comparison inputs fail visibly.

The workflow's native `paths-ignore` filters skip pushes and pull requests when every changed path matches `docs/**`, `.github/**/*.md`, or one of the root files `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `design-qa.md`, and `LICENSE`. Mixed documentation and code changes run code checks. Plugin skills are packaged product content, so changing their Markdown also runs code checks.

Run `npm run check:docs` locally for documentation-only changes. It also remains part of `npm run check` for code changes. It validates tracked Markdown formatting and local links, including images and reference links; it excludes code examples and external URLs and rejects paths outside the repository.

New pull-request runs supersede earlier runs for the same PR. Push runs are keyed by commit, so a later documentation-only push cannot cancel full coverage for a preceding host or dependency change. Nightly and manual runs are isolated from routine push/PR runs.

Failed browser runs retain Playwright traces and screenshots for seven days. The workflow uses read-only repository permissions and commit-pinned official actions; it does not receive provider credentials or run live-validation scripts.

The workflow file does not configure branch protection or required checks. Because documentation-only pushes and pull requests intentionally report no status, any future required-check policy must accommodate those skipped workflows. Keep the `Quality checks` name stable for runs that execute.

The Linux runner may skip the isolated native credential rotation test when no unlocked Secret Service is available. This does not validate desktop credential storage, native Codex rendering, or another OS; those checks remain separate acceptance work.

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

| Path          | Responsibility                                                                              |
| ------------- | ------------------------------------------------------------------------------------------- |
| `src/server/` | MCP composition, provider services, authorization, writes, and local persistence.           |
| `src/shared/` | Shared validation schemas, issue references, and state contracts.                           |
| `src/ui/`     | Embedded React interface, host bridge, drafts, and context sharing.                         |
| `plugin/`     | Portable and compatibility manifests, MCP startup configuration, icons, and bundled skills. |
| `scripts/`    | Build, artifact checks, fixture host, and explicit live-validation tools.                   |
| `tests/`      | Unit, service, and Playwright tests; mock host bridge.                                      |
| `docs/`       | User/developer guides and dated validation records.                                         |

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
