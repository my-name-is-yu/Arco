# Quality gates, error recovery, and current-host acceptance

Working-tree validation on 2026-10-24, following the [current-contract cleanup](code-quality-validation-2026-10-24.md). Local checks, GitHub Actions execution, installed artifacts, running MCP servers, provider operations, and desktop UI observations are separate evidence.

The initial gate and acceptance snapshot below precedes the tiered-CI follow-up at the end of this record. Current workflow behavior is described in the [development guide](development.md).

## Quality gate

`.github/workflows/quality.yml` runs the locked Node version, `npm ci`, `npm run check`, and Chromium browser tests for pull requests and pushes to `main`. It uses read-only repository permissions, immutable official Action revisions, and retains failed browser traces/screenshots for seven days. Live provider write scripts are excluded.

The workflow passed formatting and actionlint 1.7.12 validation. At local validation time, GitHub was inspected read-only: `main` had no branch protection and no repository rulesets, and the workflow had not yet been committed or pushed. This local record does not establish subsequent GitHub Actions execution or required-check enforcement. After its first remote run, require the stable `Quality checks` status as described in [development](development.md).

## Error contract

Server-authored safe errors carry a strict `{ error: { kind, message } }` payload through MCP. Unknown exceptions use an authored generic message; raw provider exceptions, query variables, subprocess output, and credential-store errors are not returned. The current UI rejects malformed and retired text-only failure envelopes.

Kinds distinguish authentication, permissions, API limits, timeouts, unavailable sources, missing targets, conflicts, unconfirmed writes, unsupported operations, invalid responses/inputs, and local storage. The UI retains the kind and adds a matching next step to existing error displays. An error does not turn a failed read into an empty list or change the selected scope.

Definitive provider rejections remain distinguishable from dispatched writes whose result is unknown. Unknown write outcomes retain their request ID and unsent input; no automatic mutation retry is added. Confirmed-save receipts and partial bulk outcomes remain separate from refresh failures. A GitHub label operation that fails after earlier label writes acknowledges partial saving; a Linear label definition saved before its metadata refresh fails explicitly acknowledges that save. Repeating either request ID does not replay the writes.

## Latest-build acceptance

The installed-server validator now rejects an older running server by probing the structured error contract without a provider request. It also reads the actual UI resource through the Codex app-server protocol and compares its SHA-256 with the candidate build. It does not start a model turn or certify desktop rendering.

At the start of this work, ordinary native Arco calls returned the retired `defaultRepo` connection field, demonstrating that the active conversation's server preceded the current cleanup. GitHub dedicated-Issue and Linear connection reads succeeded. These observations do not validate the candidate build.

Desktop acceptance is constrained by the available tools: native control of `com.openai.codex` was explicitly prohibited, and the MCP Apps browser had no accessible panel after successful `arco_open_issue` and `arco_open` calls. No alternate control of the protected native app was attempted. Tool completion is not panel-rendering evidence.

The remaining desktop sequence is:

1. Restart Codex after refreshing the installed candidate, then open a new conversation.
2. For both sources, open the dedicated validation Issue inline, expand its details, and return to the same inline target.
3. Add selected context, reopen/edit its annotation, and remove the attachment from Codex. Check that the marker disappears and never returns after reopening/restarting.
4. Verify actual `@Arco` search and selection for each explicit source/scope.
5. Save one reversible inline change on a dedicated validation Issue, verify the saved native value independently, and restore that value. Do not write unrelated Issues or post test comments.

No desktop action or provider mutation is claimed unless separately recorded below. Delayed acknowledgement and conflict injection remain fixture tests; they are not presented as real-host observations.

## Verification results

- `npm run check`: passed type checks, lint, formatting, 509 unit/service tests, production/fixture builds, 73-tool stdio smoke, and artifact inspection on the final source.
- Refreshed the existing local plugin with `codex plugin add arco@arco-local --json`. Installed HTML and server SHA-256 values matched the final candidate build.
- `node scripts/validate-plugin-host.mjs`: passed on a fresh Codex app-server connection, with 73 tools, both connected providers, the current structured error contract, and the candidate's actual UI-resource hash. This is protocol evidence, not desktop rendering.
- Read both existing dedicated validation Issues through the final installed production server. Both native identities matched. Explicit GitHub/Linear mention searches returned those same targets, and their Markdown resources were readable. No provider writes were performed; server stderr was empty. This verifies mention protocol behavior, not the actual composer picker.
- The four focused error-recovery browser cases passed, covering authentication/permission/API-limit guidance with cached content and unsent input, and same-ID explicit retries without automatic comment reposting. The 390 px API-limit view had no horizontal overflow; its screenshot was inspected for readable guidance and controls. Local screenshot: `dist/dev/quality-error-narrow-2026-10-24.png`.
- `npm run test:browser`: all 173 cases passed without retries in 5.1 minutes in the final run, including the reconnect assertion updated for the recovery guidance. Final type checking, targeted test lint/formatting, 136 changed-document relative links, and `git diff --check` also passed.

Local protocol/read reports are under `dist/dev/quality-codex-host-2026-10-24.json` and `dist/dev/quality-provider-read-2026-10-24.json`; they are excluded from the package and Git. Current desktop rendering, actual composer selection, inline provider writes, host-side attachment removal, and restart persistence remain unverified.

Final candidate and installed-copy SHA-256:

| Artifact     | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `arco.html`  | `c1ccda697e9836f500c48b4d2869d9a164544381a5959d734d79c13daff31a3e` |
| `server.mjs` | `63831c8d6de5803c0ff518be8a80cbcbf8fbcc96ebd31cfe675a55ce5dd441dc` |

## Tiered-CI follow-up

The [initial hosted run](https://github.com/my-name-is-yu/Arco/actions/runs/40072861309) on `9e957e9` passed in 14 minutes 13 seconds. Its complete browser suite took 12 minutes 18 seconds; all other source/build checks together took about 57 seconds, including roughly 16 seconds for 508 passing unit/service cases and one skipped native credential test.

Routine pushes and pull requests now keep all inexpensive checks and select 20 existing browser cases with `@smoke`. The complete suite still lists 173 cases. The tag-only change preserved every test title and callback body, verified by an AST comparison with the preceding revision. Nightly/manual/release events and shared host/storage/dependency changes select full coverage. Documentation-only changes still complete the same job, with tracked Markdown formatting and local-link checks.

The routing helper has 30 real Git/CLI regression cases, including renamed/deleted paths, invalid revisions, initial pushes, and script-only versus dependency changes. The documentation checker has 12 CLI regressions, including unstaged deletions, missing targets, code examples, and repository/symlink escapes. No new dependency or affected-test dependency graph was introduced.

Local `npm run check` passed all 551 unit/service cases, production and fixture builds, 73-tool smoke, documentation checks, and artifact inspection. `npm run test:browser:smoke` passed all 20 cases without retries in 22.6 seconds locally. The full browser list remains 173 cases. The runtime HTML/server implementation is unchanged by this CI-policy change.

The [routine hosted run](https://github.com/my-name-is-yu/Arco/actions/runs/40075284842) on `77f290a` selected `smoke` and passed in **3 minutes 9 seconds**, down from 14 minutes 13 seconds for the preceding all-browser workflow (about 78% less job time in this comparison). Source/build checks took 64 seconds, Chromium preparation 24 seconds, and the 20 critical browser cases 74 seconds. The full-browser step was skipped as intended. All 550 available unit/service cases passed, one native credential case was skipped, 52 Markdown files and 307 local links passed, and the 73-tool smoke/artifact checks passed. No retries were used.

The follow-up commit containing this timing record changes documentation only and exercises the `docs` profile separately. The unchanged `Quality checks` job must finish documentation checks while skipping source/build checks, browser installation, and both browser suites. The hosted run attached to that commit is the evidence for this route; this record does not require another full E2E run for a documentation update.
