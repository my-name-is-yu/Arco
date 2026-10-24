# Dependency compatibility

The lockfile is the reproducible dependency baseline. Versions below describe the checked-in package configuration, not the newest upstream releases. Arco uses public packages rather than a private Codex SDK or copied first-party runtime.

## Package roles

| Role                           | Package or tool                                                       |
| ------------------------------ | --------------------------------------------------------------------- |
| Development runtime            | Node from [`.node-version`](../.node-version), npm                    |
| UI                             | React, React DOM, TypeScript, Tailwind, Apps SDK UI, TanStack Query   |
| Single HTML build              | Vite, React/Tailwind plugins, `vite-plugin-singlefile`                |
| MCP transport and registration | `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`         |
| Host extensions                | `@openai/mcp-extensions` root exports and `/app`                      |
| Provider API                   | Public GitHub CLI; `@linear/sdk`                                      |
| Validation and storage         | Zod, `proper-lockfile`, `@napi-rs/keyring`                            |
| Testing and checks             | Vitest, Testing Library, Playwright, ESLint, Prettier, Acorn, PostCSS |

Exact versions and native optional dependencies are in [`package.json`](../package.json) and [`package-lock.json`](../package-lock.json). `@linear/sdk@99.0.0` is the Linear dependency; it is not a Codex package version.

## MCP compatibility boundary

The implementation uses MCP SDK v1 and MCP Apps v1 registration APIs with `@openai/mcp-extensions@0.2.1`. The server imports extension schemas from the package root and uses `registerAppTool` / `registerAppResource`; the UI constructs `App` and `OpenAIExtensions` through public exports.

The initial 2026-10-22 compatibility checks found that the extension package's v2-oriented `/server` helper did not match the chosen v1 server types. They also found incompatible peer/schema combinations when mixing MCP Apps majors or independent Zod versions. The current code avoids that helper and keeps the lockfile's compatible set.

Do not treat those historical checks as a permanent ban on newer versions. For an upgrade, inspect installed export/peer metadata and test the complete server, bridge, schemas, mentions, and browser flow together. Do not force peer installation or hide schema mismatches with casts or disabled library checking.

## Type configuration

[`tsconfig.json`](../tsconfig.json) uses `module: ESNext`, `moduleResolution: Bundler`, strict mode, and `skipLibCheck: false`. It explicitly includes the Apps SDK UI global declaration file. Preserve validation of the server and UI dependency types when changing this setup.

## Self-contained UI

The build inlines JavaScript and CSS into one HTML resource. Math rendering is disabled. A PostCSS pass removes unused KaTeX font declarations so the UI does not require remote font URLs. Disabling a feature does not imply that its dependency code was removed from the bundle; see [Runtime notes](dependency-runtime-notes.md).

[`scripts/check-artifact.mjs`](../scripts/check-artifact.mjs) inspects generated HTML, JavaScript, CSS, and production file paths. Keep this check alongside browser CSP tests when changing UI imports or bundling.

## Native dependency and distribution

`@napi-rs/keyring` is the runtime package kept outside the server bundle. The build copies installed native optional packages and records the platform and architecture. Rebuild and test on each target; installing source on one platform does not produce a universal artifact.

Dependency licenses remain independent of Arco's MIT license. The build generates `THIRD_PARTY_NOTICES.txt` from installed production dependencies. New dependencies must remain compatible with the package's runtime, offline artifact behavior, and notice generation.

## Upgrade verification

Run [development checks](development.md), inspect the generated module report, and review [dependency runtime notes](dependency-runtime-notes.md). Test a fixture browser under the existing CSP and check a real Codex host when changing host contracts. Native credential changes need OS-level validation. A passing build alone does not verify attachment lifecycle or native storage.
