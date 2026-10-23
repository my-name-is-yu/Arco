# General plugin host Node check

This isolated experiment uses the official MCP SDK and the public standalone
`codex app-server` protocol. It does not change the existing inline probe or
start a model turn. It installs and uninstalls only its own test plugin through
the public plugin API; the check therefore temporarily changes that plugin's
installed state. Do not use its reserved plugin name for another plugin.

After installing the root package dependencies:

```sh
node experiments/host-node-check/check.mjs --inherit-host-node
node experiments/host-node-check/check.mjs
```

The first command preserves the launching environment's `CODEX_MCP_NODE_PATH`.
The second removes it as a control. No runtime path is hardcoded. The probe
follows Code Review's macOS `/bin/sh` startup solely to test that hypothesis;
it is not a cross-platform product launcher or a product transport framework.

On 2026-10-22, the inherited variant connected and returned Node v24.21.0 from
the host path. The control failed before MCP initialize. See
`docs/connection-verification.md` for scope and remaining desktop verification.
