# Archived implementation starting point

Date: 2026-10-22. **Superseded historical document.** This page summarizes the pre-implementation handoff; it is not a contributor task list or current product policy. Use [development](../development.md), [technical stack](../technical-stack.md), and [implementation status](../implementation-status.md) for current guidance. Arco's current distribution is MIT-licensed source on GitHub.

## State at the time

The repository contained requirements, design references, and technical probes; the product package, lockfile, and application implementation had not yet been created. The separate inline probe had established standard inline rendering and MCP Apps bridge initialization in an actual Codex screenshot. It had not established product Issue operations or conversation context sharing.

The initial strategy was to use public React, MCP, and UI packages in a small local plugin instead of adding a hosted backend or a custom agent runtime. Code Review was an architectural and interaction reference, not a source of private API access or copied product implementation.

## Decisions carried into implementation

- GitHub and Linear remain the systems of record. Arco provides native Issue viewing/editing, source workflow changes, and conversation context.
- Provider IDs, scope, fields, and workflow stay distinct. No cross-service synchronization or generic workflow synthesis is introduced.
- UI, local stdio server, shared inputs/DTOs, and provider adapters form small boundaries in one package and lockfile.
- Public MCP Apps/OpenAI extensions handle host communication. A hand-written probe protocol is not a product framework.
- Queried data, browsing state, local drafts, and the shared conversation target have different owners. Refresh must preserve unsaved input.
- Credentials belong in secure local storage or the provider's existing public CLI path; they are not UI/model/log output.
- Real provider writes use dedicated validation resources, with restoration/cleanup recorded separately from fixtures.

The handoff was later amended as interaction decisions evolved. Current Arco uses **Add to chat**, grouped selections/annotations, and Codex's normal composer. Retired request-sending, new-chat preparation, and picture-in-picture experiments are not current requirements.

## Initial technical validation plan

1. Establish a compatible public SDK set with strict application type checks, stdio initialize/tool/resource calls, and a bundled UI.
2. Check ordinary plugin startup independently of first-party host behavior.
3. Verify the existing public GitHub CLI path, including Projects authorization and missing-CLI/login guidance.
4. Establish Linear authorization separately, using PKCE and secure storage if a direct local client is needed.
5. Exercise provider operations and host context one boundary at a time, retaining source identity and explicit evidence limits.

The initial compatibility baseline used MCP SDK 1.32.1, MCP Apps 1.7.5, OpenAI extensions 0.2.1 root/app helpers, Zod 4.4.3, TypeScript 6.0.3, and development Node 24.22.1. These values are historical; [`package.json`](../../package.json) and the lockfile define the current build.

## Evidence boundaries retained

Protocol, fixture-browser, native credential-store, real-provider, and actual Codex checks must be reported independently. Host-only capabilities observed in a first-party plugin cannot be assumed available to third-party plugins. A matching installed artifact also does not prove an already-running host reloaded it.

Implementation and platform assumptions changed after this handoff. The completed probe was retired on 2026-10-24; current installation does not require it. See the [retired probe record](../inline-probe-validation.md) and the [platform matrix](../platform-validation.md) for the resulting evidence and open work.
