# Current-contract cleanup and responsibility refactor

Local working-tree validation on 2026-10-24, using Node 24.22.1 on macOS arm64. This record concerns the source and fixture build; it does not establish an installed or restarted Codex plugin or live provider writes.

## Changes

- Repository issue lists now use GraphQL only. Retired REST switching, page-only continuation, and Boolean/sort query compatibility were removed. Unsupported requests and incomplete nested labels/assignees return errors. Personal account lists retain their distinct REST API and pagination.
- Removed local settings/draft repair and field recovery. Existing files must match the current schema, including their record envelope. Invalid data is preserved byte-for-byte, and both reads and writes fail. Missing files still use defaults. Settings failures block provider startup and offer a retry; new draft input remains in memory when the stored record is unreadable.
- Provider-specific hooks own list/detail queries and mutation cache updates. Shared hooks own list scroll restoration and keyboard navigation. Selection context helpers, host annotation synchronization, and annotation position restoration/measurement are independent of the rendering component.
- The internal host contract requires its current state readers. Removed the implicit personal launch for incomplete internal host implementations and default-source rendering after a settings failure.
- Removed the completed historical host-Node experiment. Historical observations remain documented. Server bundles target Node 24, and type checks reject unused locals and parameters.

## Retained behavior

Provider identifiers, workflow, permissions, partial bulk results, uncertain-write guards, and saved-but-refetch-failed receipts remain provider-specific. A failed refresh must not replay a write or discard unsent input. Promise-queue recovery permits later work after an error; it does not convert that operation to success.

GitHub's public `.github` template inheritance, an explicit unsupported-template result, manual copying when the clipboard is unavailable, and host display-mode refusal remain current functionality. These paths do not silently substitute another issue, search scope, or provider. Platform-specific state locations and missing-file defaults also remain supported.

The follow-up [fallback policy](fallback-policy.md) narrows retained paths and removes unsupported host sharing, invented continuation/coordinates, implicit scopes, silent provider-value coercion, and silent build read failures. Verification below includes that follow-up.

## Verification

- `npm run check`: passed type, lint, formatting, 447 unit/service tests, production and fixture builds, 73-tool stdio smoke, and artifact inspection.
- The source import graph from production and fixture entrypoints reaches every source module. A TypeScript symbol-reference inspection found no exports referenced only at their declaration.
- `npm run test:browser`: all 169 cases passed without retry in 5.0 minutes on the final run. The scope, reconnect, native-target, capacity, and annotation-draft regression group also passed all seven targeted cases.
- Separate fixture screenshots covered GitHub and Linear at 1440px and 390px in light/dark themes with reduced motion. Inspected wide and narrow images showed readable titles and controls without overlap; viewport checks found no horizontal overflow or page errors. Images are local artifacts under `dist/dev/code-quality-visual/`.
- Changed Markdown relative links and `git diff --check`: passed.

Regression coverage includes current-format rejection/preservation, settings-read failures, native continuation validation, provider value and identity failures, explicit scope selection, and annotation draft preservation when geometry is unavailable.

The CSS optimizer still warns about the valid `::highlight(arco-selection)` pseudo-element. Artifact inspection also reports two guarded dependency `Function` probes; the existing browser CSP tests verify that they do not execute. No dependencies or external API versions were updated. Existing real-user files and credentials were not reset or migrated.
