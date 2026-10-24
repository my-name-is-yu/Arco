# Dependency runtime and bundle notes

These notes explain how to inspect the shipped artifact and preserve a dated dependency audit baseline. They are not a current vulnerability assessment or proof that a dependency is unreachable for every input.

## Inspect the generated package

```sh
npm run build
npm run check:artifact
npm ls lodash lodash.debounce katex rehype-katex remark-math micromark-extension-math
npm audit --json
```

The audit command contacts the registry and may exit nonzero for reported advisories. Its package graph findings must be evaluated separately from what the production bundle includes and what the running application invokes. Do not apply automatic dependency fixes without checking compatibility.

The Vite build writes `dist/dev/ui-module-report.json` with each included module's `renderedLength` before final HTML inlining. These values describe module contribution before final output processing; they are not transferred bytes or the compressed artifact size. The report stays outside the production plugin.

## Historical audit baseline

An audit on 2026-10-22 reported six affected package entries: one high, one moderate, four low, and no critical entries. This was a dependency-graph result, not six independently reproduced attacks.

| Package path                     | Historical observation                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `lodash@4.17.21` via Apps SDK UI | Reported template and property-path advisories; the full `lodash` package did not remain in the inspected UI/server bundle |
| `@openai/apps-sdk-ui@0.2.2`      | Aggregate advisory entry through its dependencies                                                                          |
| KaTeX and math plugin chain      | Code remained in the inspected UI bundle even though Arco disabled math                                                    |
| `lodash.debounce@4.0.8`          | A separate package retained through UI dependencies; not interchangeable with the `lodash` advisory identity               |

Historical advisory references: [lodash template](https://github.com/advisories/GHSA-r5fr-rjxr-66jc), [lodash path handling](https://github.com/advisories/GHSA-f23m-r3pf-42rh), [earlier lodash path advisory](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg), and [KaTeX trust restrictions](https://github.com/advisories/GHSA-238p-pmpm-9mq7). Re-run the audit against the current lockfile before drawing present-tense conclusions.

The original bundle check found no `lodash/*` or Apps SDK UI Slider modules in the output. It found `lodash.debounce`, KaTeX, and the Markdown math plugin chain in the UI, and no corresponding modules in the Node server. That historical module inventory must be regenerated after dependency or import changes.

## Math configuration

Arco passes `includeMath={false}` to the Markdown renderer. The UI dependency's guarded loading path does not enable math in that configuration. However, the single-file build still includes math code, and removing KaTeX font declarations only removes CSS font resources.

Do not describe disabled math as removed JavaScript or use it alone to claim that every KaTeX attack path is unreachable.

## Guarded Function probes

The artifact checker explicitly permits two literal `Function` patterns retained by dependencies:

1. `Function('return this')` for a global-object fallback in `lodash.debounce`.
2. `Function('')` for Zod's code-generation capability test.

Arco loads [`src/ui/zod-config.ts`](../src/ui/zod-config.ts) before the UI SDK and configures `jitless: true`. A normal browser provides the global object without the debounce fallback. These guards explain intended behavior; browser CSP testing establishes whether a prohibited expression actually executes in that environment.

The checker rejects other direct `eval` / `Function` patterns, dynamic imports, external script/stylesheet resources, remote CSS URLs, development fixtures, and source maps. Static AST checks, a passing CSP browser test, and real desktop observations are separate evidence.

## Revalidation

Regenerate the bundle and module report after changing dependencies or renderer imports. Run the artifact and browser checks in [Development](development.md). Record advisory graph status, output inclusion, runtime reachability evidence, and remediation decisions separately. Follow [SECURITY.md](../SECURITY.md) for vulnerability reports rather than attaching tokens or private issue content to diagnostics.
