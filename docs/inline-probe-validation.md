# Retired inline rendering probe

Historical validation record: 2026-10-22. **Superseded:** the probe source and its catalog entry were retired on 2026-10-24. This is not an installation guide or a verification result for the current Arco build. See [installation](installation.md) and [implementation status](implementation-status.md).

## Purpose and observed result

The dependency-free local stdio probe returned an HTML card containing a fictitious Issue and a local counter. Separate tools tested standard `ui.resourceUri` and compatibility `openai/outputTemplate` linkage against the same inline-only resource. It declared no global/thread entrypoint.

Version 0.0.2 completed MCP initialize, tool listing/calls, HTML resource retrieval, and metadata checks. The public app-server discovered two tools and one resource. Installed files matched the source across ten files, including launcher permissions.

A contemporaneous actual-Codex screenshot showed the card in the conversation flow with:

- `Host mode: inline`;
- `Bridge: MCP Apps initialized`;
- `Tool linkage: standard ui.resourceUri`.

This established standard inline rendering and bridge initialization in that environment. The screenshot collection was retired from the public documentation; the observation is retained here as historical evidence. The counter was still zero, so no click interaction was established. The displayed token was not independently correlated with raw tool output. Compatibility rendering, server operations from the UI, other display modes, and Arco's provider/context workflows were not verified by this probe.

## Loader failure and correction

Version 0.0.1 passed standalone protocol checks but the plugin loader exposed no MCP server. Its warning was:

> Agent Plugins stdio command must be a bare executable name or a contained ./ path

The portable manifest used an absolute Node path. Changing it to a contained `./launch.sh` launcher allowed version 0.0.2 to expose its server and tools. This matched the [versioned public loader implementation](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/codex-mcp/src/agent_plugin_config.rs#L150-L175) inspected at the time.

The launcher was an experiment, not the current product launch design. Current Arco configuration uses `node`; consult [installation](installation.md) for its runtime requirements.

## Lessons retained

A plugin appearing installed/enabled does not prove its MCP server is loaded. Standalone protocol success does not prove the desktop has reloaded it or rendered its resource. A missing result from a standalone MCP configuration command also does not, by itself, prove a plugin-provided server failed.

The probe was removed after answering the initial rendering question. Do not recreate or install it as a dependency of Arco. Product acceptance uses the actual Arco tools, fixture host, provider checks, and Codex UI records.
