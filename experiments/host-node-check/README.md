# Historical host Node probe

This isolated experiment tests an early startup hypothesis using the public MCP SDK and `codex app-server` protocol. It is not the Arco product launcher or part of the normal installation workflow.

The probe temporarily installs and uninstalls its own reserved test plugin. It does not start a model turn, but it does change that test plugin's installed state. Inspect `check.mjs` before running it and do not reuse the reserved name for another plugin.

After installing the repository's dependencies, run from the repository root:

```sh
node experiments/host-node-check/check.mjs --inherit-host-node
node experiments/host-node-check/check.mjs
```

The first command preserves the launching environment's `CODEX_MCP_NODE_PATH`; the second removes it as a control. The macOS `/bin/sh` startup is specific to this experiment and does not establish a public host-runtime contract or cross-platform support.

On 2026-10-22, the inherited variant connected using a host-provided Node v24.21.0 and the control failed before MCP initialization. That historical result does not satisfy the current product's Node.js requirement. Arco's source-install workflow uses `node` on the executable search path; see [installation](../../docs/installation.md) and [connection verification](../../docs/connection-verification.md).
