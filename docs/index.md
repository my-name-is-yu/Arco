# Arco documentation

Arco is an MIT-licensed local Codex plugin for GitHub and Linear issues. Start with the [project README](../README.md).

## Use Arco

- [Installation and updates](installation.md): requirements, source builds, local installation, provider setup, and troubleshooting.
- [Product scope](product-scope.md): responsibilities, supported workflows, and deliberate exclusions.
- [Operation reference](issue-operations.md): provider-native operations and write semantics.
- [Views and interactions](screen-structure.md): personal lists, project lists, detail panels, and inline cards.
- [Notification policy](design/notifications.md): retained exceptions and feedback for ordinary successful actions.
- [Personal and project views](project-viewers.md): repository selection and conversation scope.
- [GitHub account discovery](github-account-discovery.md): assigned, created, mentioned, and account-wide lists.
- [Authentication and distribution](auth-distribution.md): provider credentials and the source-distribution model.
- [Local data](local-data-boundary.md): settings, drafts, annotation snapshots, and invalid-data handling.
- [Security and privacy](security-and-privacy.md): data flow and security boundaries.

## Contribute

- [Contributing](../CONTRIBUTING.md) and [security reporting](../SECURITY.md).
- [Development guide](development.md): commands, fixtures, source map, packaging, and verification.
- [Architecture](technical-stack.md): runtime flow and component ownership.
- [Fallback policy](fallback-policy.md): retained recovery paths and required current contracts.
- [Requirements](requirements.md): behavior and acceptance criteria.
- [Developer entry points](implementation-handoff.md): where to start making changes.
- [Dependencies](dependency-compatibility.md) and [runtime packaging](dependency-runtime-notes.md).
- [Design QA](../design-qa.md), [design reference](code-review-reference.md), [UX principles](plugin-ux-research.md), and [host presentation examples](plugin-ui-real-examples.md).

## Status and validation

[Implementation status](implementation-status.md), [platform validation](platform-validation.md), and [connection verification](connection-verification.md) describe evidence and open checks. Dated records preserve the environment and limits of earlier observations; they are not a claim that the current revision passed those checks again.

[Quality gates and error recovery](quality-gates-validation-2026-10-24.md) records the current CI setup, error-contract checks, and latest-build desktop acceptance limits.

| Area                | Records                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub              | [Live operations](github-live-validation.md), [list behavior](github-list-validation-2026-10-24.md), [network and paging](github-network-validation-2026-10-24.md)                                                            |
| Linear              | [Authorization and live operations](linear-validation.md), [list behavior](linear-list-validation-2026-10-24.md)                                                                                                              |
| Architecture        | [Current-contract cleanup](code-quality-validation-2026-10-24.md), [refactor checks](refactor-validation-2026-10-24.md), [native host checks](real-codex-refactor-validation-2026-10-24.md)                                   |
| Inline presentation | [Card design](design/inline-card-validation-2026-10-24.md), [presentation policy](design/presentation-policy-validation-2026-10-24.md)                                                                                        |
| Interaction         | [UI audit](design/ui-audit-2026-10-23.md), [loading and motion](design/motion-loading-validation-2026-10-23.md), [hover](design/hover-validation-2026-10-23.md), [hover scaling](design/hover-scale-validation-2026-10-23.md) |

## Historical context

These documents explain earlier choices and retired experiments. They do not override the current guides.

- [Initial-view exploration](initial-view-review.md).
- [Distribution and funding context](monetization-research.md).
- [Retired inline probe](inline-probe-validation.md).
- [Early implementation plan](archive/implementation-handoff-2026-10-22.md) and [early technical exploration](archive/technical-stack-2026-10-22.md).
- [Early visual exploration](design/image-prompts.md) and [reference-inspired exploration](design/code-review-image-prompts.md).
