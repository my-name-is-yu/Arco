# Project and personal viewers

Arco separates personal issue discovery from a chat's project browsing. Opening either view does not share context or mutate an issue.

| Entry                  | Tool                | Initial scope                                                                   |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------- |
| Global Arco entry      | `arco_open`         | Personal **My issues** view; optional explicit provider                         |
| Chat/project entry     | `arco_open_project` | GitHub **Project issues** view, with explicit repository choice when unresolved |
| Inline issue           | `arco_show_issue`   | One explicit native issue reference                                             |
| Expanded issue details | `arco_open_issue`   | The same explicitly referenced issue in the panel                               |

These tools use shared UI resources with validated launch data. Entrances are not inferred from fullscreen or inline display modes.

## Repository selection

The server may resolve GitHub repositories from explicitly supplied MCP roots. It validates local file roots, canonical paths, GitHub remote identities, and ambiguity. Multiple candidates require a choice; the server does not pick an arbitrary remote.

When the host provides no usable roots, the project viewer presents a repository chooser. Codex versions observed during development did not advertise roots support for the installed plugin. This is a host observation, not a guarantee about all future versions.

Arco does not use the MCP process's `cwd` to infer the chat project. Installed plugin loaders can set that directory to the cached plugin, so it is not trustworthy evidence of the user's repository.

## Persistence and isolation

The host's chat ID becomes a SHA-256 settings key. Arco stores the selected repository under that opaque key, not the raw ID or working path. If explicit workspace roots are available, their validated canonical scope can provide a project key instead.

At most 100 chat/repository associations and saved repositories are retained. Choosing an entry refreshes its retention position. Personal account filters, repository filters, and chat project selection remain separate.

Restoring an existing shared issue is distinct from choosing a fresh list's default. Linear teams and GitHub Projects are not inferred from a Git repository. Opening a card does not silently change active-source or scope preferences.

See [Local data](local-data-boundary.md) for paths and concurrency behavior.

## Protocol diagnostics

```sh
node scripts/probe-project-context.mjs
npm run build
node scripts/probe-project-context.mjs --production
```

These diagnostics create isolated temporary Codex/Arco state, compare a repository directory with a non-repository directory, and report roots and thread metadata through direct MCP registration. The production mode invokes the built server's launch tools and uses an existing read-only GitHub connection. It does not install a plugin, start a model turn, change provider data, or establish installed-loader behavior. Output explicitly sets `pluginLoaderVerified: false`.

For an already installed plugin:

```sh
node scripts/validate-plugin-host.mjs
```

This opt-in check uses the public app-server protocol and the current user configuration. It verifies registered tools and launch/connection results. It is separate from desktop entrypoint refresh, UI rendering, and composer behavior. See [Connection verification](connection-verification.md).

## Historical evidence

On 2026-10-23, direct registration in Codex `0.163.0-alpha.11.2` and the then-current PATH CLI exposed chat IDs but no usable roots. A subsequent installed-plugin check showed that the Agent Plugins loader used the cache directory as the process directory. This invalidated the earlier direct-server cwd inference.

A separate native-hook experiment did not provide project context at panel opening without a model turn. Arco therefore uses explicit launch metadata and manual selection rather than lifecycle hooks or hook-trust changes.

Fixture checks covered manual choice, reload, per-chat isolation, personal filters, shared issue context, host updates, and eviction at the retention limit. The historical installed-loader check verified unresolved project launch data and a chat-specific opaque key. Those results are dated protocol/fixture evidence; they do not establish that a current desktop installation has reloaded its catalog.

Use [implementation status](implementation-status.md) and [Platform validation](platform-validation.md) for broader evidence limits.
