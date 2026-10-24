# Platform validation

Evidence dates: 2026-10-23 to 2026-10-24. This matrix records historical native checks and outstanding platform work. It is not a guarantee for every current Codex version. Follow [installation](installation.md) and [development](development.md) for the current build procedure.

| Platform            | Recorded evidence                                                                                                                    | Remaining validation                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| macOS arm64         | Native credential write/read/removal, cross-process refresh, plugin launch, GitHub/Linear reads and writes, and expanded Codex views | Remaining conversation and final inline/presentation checks in [implementation status](implementation-status.md)               |
| Windows x64 / Arm64 | Platform-specific path and credential-store branches exist; no native execution was recorded                                         | Matching-platform build, native credential storage, plugin launch, provider operations, and actual Codex UI                    |
| Linux x64 / ARM64   | The adapter explicitly requests Secret Service and refuses plaintext fallback; no native execution was recorded                      | Matching-platform build, an available/unlocked desktop Secret Service, plugin launch, provider operations, and actual Codex UI |

No macOS Intel validation is recorded. An operating system being supported by the host does not establish Arco support on that system. Check the current host requirements before choosing a target.

## Build and acceptance procedure

Build from the lockfile on each target. [`scripts/build-server.mjs`](../scripts/build-server.mjs) includes the locally installed native keyring binding and writes its OS/architecture to `dist/plugin/runtime-platform.json`. An artifact built on one platform is not a universal package.

Run the local checks described in [development](development.md), then run `node scripts/validate-plugin-host.mjs` with the configured local plugin. The native rotation test uses an isolated fake credential and removes it afterward. A skipped native credential test leaves that acceptance gate unverified even if all other checks pass.

Validate the real Codex UI separately, using dedicated provider Issues for any writes. Record the build, host version, OS/architecture, credential-store availability, operations performed, and cleanup. A headless container can help test server logic but cannot establish desktop credential prompts or Codex UI behavior.

Only one macOS arm64 environment was available for the recorded runs. Windows and Linux remain open validation work; no cross-platform release claim follows from the existing source branches.
