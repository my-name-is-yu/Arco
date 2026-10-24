# Archived technical baseline

Date: 2026-10-22. **Superseded historical document.** This records the design before product implementation. It does not define current dependencies, installation, support, or release readiness. Use the [current technical stack](../technical-stack.md), [development guide](../development.md), and [installation guide](../installation.md). Arco is now MIT-licensed source distributed through GitHub.

## Architecture selected at the time

The baseline paired a bundled React UI with a local Node ESM stdio MCP server. Both UI and conversation tools would call the same provider operations. GitHub/Linear would remain authoritative; local settings, drafts, and secure credentials would not become an independent Issue database.

| Area              | Historical choice and purpose                                                           |
| ----------------- | --------------------------------------------------------------------------------------- |
| UI                | React/TypeScript, Apps SDK UI, Tailwind, and host theme variables                       |
| UI build          | Vite and a single-file HTML bundle, without a production development server             |
| Retrieved data    | TanStack Query for scope-aware cache, pagination, invalidation, and errors              |
| Local interaction | React state for selection, filters, expanded views, and unsaved input                   |
| Server            | Node ESM, official MCP SDK, MCP Apps, and public OpenAI extensions                      |
| Validation        | Zod for tool and provider-boundary inputs; JSON DTOs instead of SDK model instances     |
| GitHub            | Existing public `gh` authentication and `gh api`, subject to operation/scope validation |
| Linear            | Official SDK/GraphQL, with independent authorization validation                         |
| Storage           | Secure credentials; small local settings/draft files; memory cache                      |

The design did not require SSR, a routing library, another global store, a generic provider framework, a hosted account service, billing, an Issue mirror, a synchronization daemon, or a custom inference runtime.

## Public package compatibility snapshot

| Component                   | Version tested for the starting baseline |
| --------------------------- | ---------------------------------------- |
| React / ReactDOM            | 19.3.1                                   |
| TypeScript                  | 6.0.3                                    |
| Vite / React plugin         | 8.3.5 / 6.1.2                            |
| Tailwind / Vite integration | 4.3.3                                    |
| Apps SDK UI                 | 0.2.2                                    |
| TanStack Query              | 5.104.5                                  |
| MCP SDK                     | 1.32.1                                   |
| MCP Apps                    | 1.7.5                                    |
| OpenAI extensions           | 0.2.1, root and `/app` helpers           |
| Zod                         | 4.4.3                                    |
| Development Node            | 24.22.1                                  |

The public package spike found a peer mismatch when mixing the then-current OpenAI extension with MCP Apps v2. A v1 server/Apps pairing with the root/app extension helpers passed the required type/protocol checks without a fork or forced installation. The `/server` helper was excluded because it required a different server major. This was a compatibility snapshot, not a permanent decision to freeze an SDK major. Current exact versions belong in the package and lockfile.

## Boundaries and state

The proposed layout separated `src/ui/`, `src/server/`, and `src/shared/`, with build/protocol scripts, tests, plugin manifests, and generated `dist/` output.

UI code would not import server implementations, Node built-ins, or provider SDKs. Shared code would hold schemas/DTOs without credentials or raw SDK instances. Common abstractions were limited to genuinely shared references, summaries, and errors; native edits and detailed attributes remained provider-specific.

Query keys would include provider, connection, repository/team, Issue/Project/field, and search conditions. Refetching could not overwrite unsaved drafts. Saves would invalidate and reread the provider. Creation/comments and partial bulk failures required explicit deduplication/error behavior rather than unconditional write retries.

Data tools and display resources were separate so ordinary edits would not remount a whole card. Host notifications, focus, and explicit refresh would be verified as refresh triggers; query cache alone was not an iframe synchronization system.

## Build and security choices

Vite plus the single-file plugin would produce one HTML asset; esbuild would produce the server bundle, with TypeScript used for checking. Build inspection would reject external scripts/styles, unwanted CSS URLs, fixture data, and unnecessary source maps. Unused external KaTeX font declarations could be removed through a PostCSS AST when math rendering was disabled.

Provider images were a separate authenticated data path. Credentials would not be sent to the iframe to solve image loading. GitHub CLI calls would use argument arrays rather than shell interpolation. Linear authorization would be validated independently instead of borrowing another connector's credential cache.

Credential bindings, atomic storage, and cross-process locks were initially candidates to add only when their need was demonstrated. The implemented secure-storage and refresh design is documented in the [current stack](../technical-stack.md) and [Linear validation record](../linear-validation.md).

## First-party reference limits

The baseline was informed by an installed Code Review distribution inspected on 2026-10-22/23. It showed React 19.2.7, Tailwind 4.3.3, TanStack Query markers, Node ESM/stdio, MCP SDK 1.29.0, MCP Apps 1.7.5, and Zod 4.4.3. Some exact package versions and build settings were unavailable; Vite involvement was inferred from generated markers.

Those observations did not prove access to the original development repository, use of Apps SDK UI, or availability of private host/backend capabilities to Arco. Reference assets and private protocols were not a product API contract. Arco selected public compatible dependencies instead of duplicating that distribution's versions.

The initially observed host-Node environment variable was also not a confirmed third-party contract. The current product uses the documented runtime/launcher described in [installation](../installation.md), rather than an absolute path from the development machine.

## Verification plan and subsequent state

The baseline called for separate static checks, logic/adapter tests, fixture-browser interaction, artifact/protocol smoke, native-platform behavior, provider authorization/writes, and actual Codex display/context acceptance. It did not equate an OS branch with native execution or a fixture result with a real host result.

Much of the implementation followed after this document. Consult [implementation status](../implementation-status.md) for dated results, [platform validation](../platform-validation.md) for unverified environments, and [dependency compatibility](../dependency-compatibility.md) for the maintained compatibility discussion. Original internal handoff instructions and obsolete publication plans are not current contributor guidance.
