# Project and personal viewers

Updated: 2026-10-23. The global Arco entry opens the connected account's personal
Issue viewer. The chat entry opens a project viewer where the user chooses a
GitHub repository. That choice is remembered for that chat and does not change
the personal viewer. Opening either viewer does not share context or update an
Issue.

The latest 100 chat associations and saved repositories are retained. Choosing a
repository refreshes its position; older entries are dropped at the limit.

## Launch boundary

`arco_open` is the global entrypoint; `arco_open_project` is the thread entrypoint.
Both use the same UI resource. MCP Apps provides the instantiating tool in
`hostContext.toolInfo.tool`, and each result includes a `launch` object. The UI
does not infer an entrance from fullscreen or inline display mode.

An explicit MCP roots response can identify a repository automatically. Current
Codex does not advertise roots support and returns an empty roots list, so this
installation starts the project viewer with a repository chooser. Codex's tool
metadata supplies the chat ID; Arco hashes that ID into an opaque settings key
for the manual choice. Global browsing never inherits that chat's repository.
Restoring an explicitly shared Issue is separate from choosing a fresh list's
default scope. Linear teams and GitHub Projects are not inferred from Git
repositories.

The user selected manual repository choice first on 2026-10-23. No lifecycle
hook, additional hook trust, or model turn is required to open the viewer.

## Why the process directory cannot identify the project

Plain MCP configuration and installed plugin loading have different rules. The
installed desktop bundle reports Codex `0.163.0-alpha.11.2`; its matching public
source establishes these boundaries:

- A recognized root `plugin.json` takes precedence over the native
  `.codex-plugin/plugin.json`. Arco's root manifest uses the Agent Plugins schema.
  [Manifest selection, lines 43-60](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.2/codex-rs/utils/plugins/src/plugin_namespace.rs#L43).
- The Agent Plugins loader replaces an omitted MCP `cwd` with `${PLUGIN_ROOT}`
  and permits only paths within plugin or plugin data directories.
  [Agent Plugins normalization, lines 217-243](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.2/codex-rs/codex-mcp/src/agent_plugin_config.rs#L217).
- A plain local stdio registration without `cwd` instead receives the local
  runtime directory. The launcher uses that fallback when no configured
  directory exists. [Local launcher, lines 191-194](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.2/codex-rs/rmcp-client/src/stdio_server_launcher.rs#L191),
  [process creation, lines 277-283](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.2/codex-rs/rmcp-client/src/stdio_server_launcher.rs#L277).

Consequently, a successful direct-server cwd probe does not prove that an
installed plugin receives the chat directory. In the installed Arco probe, the
process directory was the plugin cache version directory, `0.1.0`. Arco does not
use `process.cwd()` to resolve a project.

Native plugin hooks can receive the session ID and directory, but they do not
provide a context source at panel opening. In this version session creation
queues `SessionStart`, and the turn runner executes it later.
[Session creation, line 1984](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.2/codex-rs/core/src/session/session.rs#L1984),
[turn runner, line 333](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.2/codex-rs/core/src/session/turn.rs#L333).
Agent Plugins omit hooks altogether in this loader.
[Plugin loader, lines 970-972](https://github.com/openai/codex/blob/rust-v0.163.0-alpha.11.2/codex-rs/core-plugins/src/loader.rs#L970).
Native plugin hooks also need explicit user trust.
[Official hook guidance](https://learn.chatgpt.com/docs/hooks#plugin-bundled-hooks).

## Reproduce the public protocol checks

From the Arco checkout, run:

```sh
node scripts/probe-project-context.mjs
```

The script prefers the actual ChatGPT desktop bundled Codex binary on macOS and
otherwise uses `codex` on PATH. It creates a disposable diagnostic MCP server
through direct `mcp_servers` configuration and an isolated `CODEX_HOME`. It starts
two ephemeral chats: this checkout and a temporary non-repository folder. It
checks their Node working directories and reports whether thread ID metadata and
roots are available. This is a transport diagnostic, not an installed-plugin
test.

After building, also check the actual server's entry tools through that direct
registration:

```sh
npm run build
node scripts/probe-project-context.mjs --production
```

This starts `dist/plugin/server.mjs` with a disposable Arco data directory and
invokes only `arco_open` and `arco_open_project`. It uses the existing GitHub CLI
connection for their read-only connection check. With no roots, the project
result must remain unresolved even when the process directory is a repository;
the two chats must receive distinct opaque settings keys. The global result
must stay personal with no repository or project key. The JSON output explicitly
reports `pluginLoaderVerified: false`.

To check the separately installed plugin through its actual loader, run:

```sh
node scripts/validate-plugin-host.mjs
```

These probes do not start a model turn, install a plugin, update an Issue, or
change current user settings. The isolated probe removes its temporary files and
prints only verification facts and validated GitHub repository names. It does
not print arbitrary metadata, remote URLs, environment variables, credentials,
Issue titles, or bodies.

## Verification record and limits

On 2026-10-23, the initial plain-registration probe passed with the bundled
`0.163.0-alpha.11.2` binary: each stdio directory matched its requested chat
directory, both calls had a thread ID, roots were not advertised, and both roots
lists were empty. The PATH CLI `0.161.0` returned the same facts. An initial
direct-registration production probe detected Arco's repository, but that result
bypassed plugin loading and was not evidence for automatic project detection in
the installed product.

The subsequent installed-plugin probe exposed the cache directory behavior.
An isolated comparison confirmed that Agent Plugins use the cache directory,
while native plugins with a known absolute launcher can retain the chat
directory. Native MCP did not expand `${PLUGIN_ROOT}` or provide plugin-root
environment variables, so changing manifest format alone was not a portable
solution. Neither manifest was removed.

A separate isolated hook probe installed native and Agent Plugins in a
temporary `CODEX_HOME`. `hooks/list` exposed only the native hook, initially
untrusted. Starting ephemeral chats produced no hook records before MCP reads,
including vetted probe-only invocations with hook trust bypassed. No bypass or
hook trust was written to the user's configuration, and no model turn ran.

Public app-server verification, installation, and desktop rendering are separate
checks. A successful protocol check does not prove that the desktop menu and chat
panel have refreshed their entrypoints or UI. Open both entrances in the desktop
app and check their headings, repository chooser, and retained selections
separately.

## Local checks after removing cwd inference

Checked on 2026-10-23 with the desktop bundled Codex `0.163.0-alpha.11.2`:

| Check                                         | Result                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Script syntax, target ESLint, target Prettier | Passed                                                                                                    |
| Isolated plain-registration diagnostic        | Passed; thread IDs available, roots absent in both chats                                                  |
| Built server through direct MCP registration  | Passed; both project launches remain `unavailable` with no selected repository, even in the Arco checkout |
| Personal entry in both chats                  | Passed; no repository or project key inherited                                                            |
| Project settings isolation                    | Passed; the two ephemeral chats receive distinct opaque keys                                              |

Both probe commands completed with exit code 0 and removed their temporary
directories. Their output explicitly marks installed-plugin loading and desktop
rendering as unverified.

Separate checks against the final manual-selection implementation:

- `npm run check` passed typecheck, ESLint, 218 unit tests, build, 69-tool smoke,
  and artifact checks. After the final retention fix, typecheck, target lint and
  formatting, build, smoke, and artifact checks passed again.
- The final launch browser suite passed 10/10 cases, covering manual choice,
  reload, per-chat isolation, personal filters, shared Issue context, host
  updates, and the 101st chat/repository choice. The existing 93 browser cases
  passed across the original run and focused reruns after updating entrance
  assumptions in the fixture tests.
- `validate-plugin-host.mjs` passed through the installed plugin loader with the
  bundled desktop binary: 69 tools, personal global result, and unresolved
  project result with the exact hash of that chat's ID. Both provider connection
  checks succeeded. This is protocol validation, not desktop rendering.
- The local plugin cache was refreshed from `dist/plugin`; server and HTML hashes
  matched. The running desktop app was not restarted. Reloading its entrypoint
  catalog remains a desktop restart step.
- The browser fixture was visually checked through the in-app browser. These
  screenshots show fictional data, not authenticated GitHub content:
  [project chooser](design/references/2026-10-23-project-viewers/project-manual-fixture.png),
  [selected repository](design/references/2026-10-23-project-viewers/project-fixture.png),
  [personal viewer](design/references/2026-10-23-project-viewers/personal-fixture.png).

The full `format:check` still reports the unchanged pre-existing
`tests/hover-browser.spec.ts`; changed source, scripts, tests, and README pass
targeted Prettier checks. Actual desktop entrance rendering after restart remains
unverified.
