# Native platform acceptance

Updated: 2026-10-23. This matrix preserves D12; passing fixture tests on one Mac does not establish another operating system's native behavior.

| Platform                    | Current evidence                                                                                                                             | Remaining gate                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| macOS arm64                 | Native credential write/read/removal, cross-process refresh, public plugin launch, GitHub/Linear reads and writes, expanded real Codex views | The remaining real-host conversation and display checks in [implementation status](implementation-status.md)           |
| Windows x64 / Arm64         | Source has native path and credential-store branches; no execution here                                                                      | Build on that platform; native credential storage and plugin launch; real source operations and Codex UI               |
| Supported Linux x64 / ARM64 | Source explicitly uses Secret Service and refuses plaintext fallback; no execution here                                                      | Build with the matching native binding; unlocked desktop Secret Service; plugin launch, source operations and Codex UI |

Current official host documentation lists [Windows packages](https://learn.chatgpt.com/docs/enterprise/windows-deployment#install-from-an-offline-package) and [Linux desktop preview distributions and architectures](https://learn.chatgpt.com/docs/linux/linux-app). Preview support is not an Arco validation result. No macOS Intel claim is made here.

Build separately from the lockfile on each target. `scripts/build-server.mjs` includes the locally installed native keyring binding and records its platform/architecture in `dist/plugin/runtime-platform.json`; this Mac's artifact is not a cross-platform package.

Run `npm ci`, `npm run check`, `npm run test:browser`, and `node scripts/validate-plugin-host.mjs` on the target. The existing `tests/linear-native-rotation.test.ts` uses an isolated fake credential and removes it afterward. A skipped native credential test means the native storage gate remains unverified, even if the rest of the suite passes. Then complete the actual Codex UI checks with dedicated source Issues and record the result separately from app-server/fixture success.

The user confirmed on 2026-10-23 that only this Mac is available for this validation. No Windows or Linux desktop environment is attached to this task. The local Docker client has no running daemon, and a headless container would not establish Codex desktop behavior. Those environments are still required before marking D12 complete.
