# Arco state machines

This is the consolidated state and transition contract for the app, including
confirmed violations, their issue groups, fixes, and regression evidence. Review
baseline: `aa97891788160631421eb29215a6feb1618511a4`. Updated: 2026-11-07.

A machine below is a finite abstraction of the implementation, not a proposed
framework. Explicit string states and implicit combinations of booleans, maps,
revisions, promises, and query status are both included. Independent dimensions
remain independent: for example, a failed refresh can coexist with previously
loaded data, and a multi-step write can be both confirmed and uncertain.

## Confirmed bugs, ordered by impact

All entries below have deterministic failing-before-fix regressions. “Fixed”
means implementation and regression coverage are included in this change. The
linked issues track review and integration. Tests use fictional data and
controlled interleavings, not live provider mutations.

| Priority | Issue group                                                                                                       | Reachable invalid state                                                                                                      | Current disposition                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| P1       | [#119: Preserve unseen saved drafts](https://github.com/my-name-is-yu/Arco/issues/119)                            | Autosave replaces an existing draft that was never restored or compared with current input.                                  | Fixed; controller and both providers' creation-form regressions.                   |
| P2       | [#120: Bind reads and UI data to the account](https://github.com/my-name-is-yu/Arco/issues/120)                   | A read completes after disconnect/account replacement; an old account's cached issue remains actionable under a new account. | Fixed; service reads, presentation assembly, and UI account-generation boundaries. |
| P2       | [#121: Preserve bulk mutation evidence](https://github.com/my-name-is-yu/Arco/issues/121)                         | Acknowledged or ambiguous Linear bulk write is reported as definitely safe to repeat.                                        | Fixed; per-member mutation evidence survives postflight failures.                  |
| P2       | [#122: Preserve settings revisions and connection edits](https://github.com/my-name-is-yu/Arco/issues/122)        | UI settings revision decreases; a stale Symphony form overwrites or removes another view's saved connection.                 | Fixed; monotonic publication and form-baseline conflict checks.                    |
| P3       | [#123: Bound fixture sessions and commit responses after reads](https://github.com/my-name-is-yu/Arco/issues/123) | Starting sessions exceed the cap, or a missing rebuilt asset causes a second HTTP header write and crashes the fixture host. | Fixed; reserve startup capacity and read assets before committing HTTP headers.    |

### #119: initial draft load versus typing

Evidence: [draft controller](src/ui/useDraftPersistence.tsx),
[regressions](tests/draft-controller.test.ts), and
[creation-form browser regressions](tests/create-draft-recovery-browser.spec.ts).

1. Disk contains draft D at revision n. Its initial read is held in flight.
2. The user types L. The controller advances its local version so the old read
   cannot replace visible input.
3. The read returns D/n. Previously, the persistence layer accepted n as the
   save baseline even though the controller suppressed restoring D.
4. Autosave wrote L at n+1, destroying unseen D without comparison. Editing
   before the first load reached the same state.

The fix tracks whether a saved baseline was restored or explicitly resolved.
Before an initial autosave, different unseen content produces `conflict`; the
persisted record and local input both survive. Matching content can save without
an unnecessary conflict. Explicit resolution still uses compare-and-swap.

### #120: delayed reads and account transitions

Evidence: [Linear service](src/server/linear/service.ts),
[SDK regressions](tests/linear-sdk.test.ts),
[GitHub read-scope regressions](tests/github-connection-scope.test.ts),
[presentation assembly](src/server/mcp.ts), and
[Linear account browser regressions](tests/linear-account-cache-browser.spec.ts).

The concrete service schedule holds an account-A viewer, scopes, or issue
response, disconnects or replaces its credential, then releases the response.
Previously the response succeeded; an old connection completion could also
replace a newly observed generation. The GitHub counterpart holds A's issue
response, observes account B through `connection()`, then releases A's body.

Review of PR head `ab8dbfed854074af6886031a33da2b0a099de44b` found a remaining
Linear round-trip race: hold an A connection or issue read, observe B, restore
the exact A credential, observe A's new generation, then release the original
read. The token fingerprint matches again, so the old check accepted the stale
result and labeled a delayed connection with the new A generation. Four official
SDK HTTP regressions reproduced this with generation observations through both
`authGeneration()` and completed connection reads. A read now captures its first
client's generation after token refresh and compares both that generation and
the credential fingerprint at completion. A stale result cannot acquire the
current generation; fresh retries succeed without changing it. Expired-token
refresh before client creation remains valid, while refresh during a read still
rejects the old response. Write evidence and private grant bindings are separate.

The concrete UI schedule first caches account A's issue, observes account B in
the same Linear workspace, then fails B's issue reads. Previously A's title,
body, and comments remained displayed alongside B's actions. Held write
acknowledgments also revived old data after A→B and A→B→A transitions. In a
separate startup case, B is the first verified connection after A's launch
snapshot was fetched, so there is no previous connection to compare. That also
previously displayed A's cached detail when B's reads were denied. A temporary
failure under the same generation must continue to retain data; account
replacement must not.

Read completion now checks the credential generation used to start the read.
Multi-read issue presentations must retain one generation throughout assembly.
Their app-only metadata carries the captured opaque Linear generation per
connection alias. The first UI connection verifies it before reusing a launch
snapshot. Later-received snapshots from an older generation are also rejected
for both detail seeding and tab summaries.
The Linear UI invalidates provider caches and ignores superseded completions on
an observed account-generation change, including A→B→A. Definite write
acknowledgments retire their request IDs even after navigation; failed or
unacknowledged attempts retain their bindings. Draft ownership uses provider user
identity, separately from access-token rotation.

### #121: postflight authorization failure after a bulk mutation

Evidence: [Linear bulk](src/server/linear/bulk.ts),
[mutation tracking](src/server/write-guard.ts), and
[SDK regressions](tests/linear-sdk.test.ts).

1. A bulk member reaches the provider mutation boundary.
2. The provider acknowledges a priority/label change, or the response leaves
   application uncertain.
3. The immediate postflight credential-store read fails transiently. This
   replaces the ordinary result with an auth error before `saved = true` runs.
4. A later outer scope read succeeds. Previously the bulk member returned
   `saved: false, retryable: true`, despite changed source data or uncertainty.
5. “Retry failed issues only” uses a fresh parent request ID, allowing another
   dispatch; replay protection for the old parent cannot prevent that repeat.

Each member now has an isolated write-progress scope. Eligibility requires
neither confirmed nor uncertain progress. Regressions cover property and label
writes, acknowledged and ambiguous responses, and an independent later preflight
failure after an earlier successful member. Earlier success does not make every
later member non-retryable.

### #122: settings response reordering and stale connection forms

Evidence: [settings controller](src/ui/useSettings.ts),
[settings regressions](tests/settings-controller.test.ts),
[Symphony workspace](src/ui/SymphonyWorkspace.tsx), and
[Symphony browser regressions](tests/symphony-browser.spec.ts).

Two distinct schedules share the same revision/baseline discipline:

- An r0 read finishes after an r1 commit, or an r1 write response arrives after
  r2 was accepted. Previously direct query publication rolled the cache backward
  while disk stayed newer. Publication now cancels older in-flight reads and
  refuses to replace a greater cached revision.
- Editor A opens connection C. View B saves C'. A's Save or Remove fetches the
  latest settings revision, then previously replaced C' with A's stale full
  form, or deleted it. The server's revision check passed because A had just
  fetched the latest revision. Save/Remove now compare the original connection
  with the latest saved connection before issuing the update. A conflict retains
  input and C'; unrelated connection edits remain compatible.

The browser regressions execute real fixture RPC updates between form opening
and Save/Remove. Both failed before the fix because the stale dialog closed.

### #123: fixture session admission and HTTP response commitment

Evidence: [fixture host](scripts/dev-host.mjs) and
[lifecycle regressions](tests/dev-host-lifecycle.test.ts).

Hold startup before client readiness and send 257 creation requests. Previously
all could pass `sessions.size < 256` before any registered, allowing extra child
processes. Admission now includes pending starts, reserves before the first
`await`, and releases in `finally`. The regression holds startup deterministically
without creating hundreds of real subprocesses and checks overflow and recovery.

A second schedule occurred while a browser preview and build ran concurrently:
`GET /arco.html` committed status 200, then awaited an asset read while the build
replaced `dist/`. A missing asset caused the catch handler to write status 500
on the same response, raising `ERR_HTTP_HEADERS_SENT` and terminating the host.
The route now completes the asset read before committing successful headers.
A regression rejects the read, verifies exactly one 500 response, then supplies
the rebuilt asset and verifies a later request succeeds with 200.

## Authentication and account machines

### Linear OAuth transaction (explicit)

Implementation: [auth](src/server/linear/auth.ts).
States: `idle`, pending listener, processing callback, `connected`, `failed`,
cancelled, and service closed. Processing/cancelled/closed are implicit control
states; the status API exposes only `idle/pending/connected/failed`.

Invariants: one listener transaction per connection; exact loopback callback
host/path; constant-time state check; at most one code exchange per transaction;
a cancelled/expired transaction cannot persist a late token; a new consent grant
gets a new private authorization ID. Transaction status and stored credentials
are separate: failed reauthorization may coexist with an older valid grant.

| From               | Event/guard                                              | To and effect                                          |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------ |
| Idle/terminal      | Begin, valid client ID and free port                     | Pending; start five-minute deadline and PKCE listener. |
| Pending            | Wrong path/state                                         | Pending; reject callback without exchange.             |
| Pending            | Valid authorization code                                 | Processing; reject duplicate callbacks with 409.       |
| Processing         | Exchange and credential-store write succeed while active | Connected; close listener.                             |
| Pending/processing | Denial, exchange/store/listen failure, deadline          | Failed; close listener.                                |
| Pending/processing | Disconnect                                               | Cancel transaction, remove grant, status returns idle. |
| Any live service   | Close                                                    | Close transactions; future Begin fails.                |

### Linear stored grant and public identity (implicit)

Implementation: [auth](src/server/linear/auth.ts),
[service](src/server/linear/service.ts).
States: missing, fresh, refresh-needed, refreshing, retained old pair after
failure. Public observed generation is a separate memory-only token-fingerprint
mapping; private authorization ID binds writes and survives token refresh.

Invariants: serialize refresh/disconnect through the per-connection interprocess
lock; persist the replacement token pair before exposing it; preserve the old
pair on refresh failure; never expose private grant IDs. A read result must still
match its starting credential and observed generation before publication (#120).
An observed A→B→A invalidates an old A read even when the token returns to its
original value. Connection results publish their captured, verified generation.

| From                     | Event/guard                                                | To and effect                                                      |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Missing                  | Access token/session scope request                         | Auth failure.                                                      |
| Fresh (>60 seconds left) | Access token request                                       | Fresh; return stored token.                                        |
| Expiring/forced          | Refresh under lock                                         | Refreshing; reread current stored pair.                            |
| Refreshing               | Valid response and store write                             | Fresh new pair; same private grant ID.                             |
| Refreshing               | Failure                                                    | Retain old pair; report error.                                     |
| Legacy grant             | First write-scope lookup                                   | Add private grant ID once under lock.                              |
| Saved grant              | Successful new OAuth consent                               | Replace pair and private grant ID.                                 |
| Saved grant              | Disconnect/revoke succeeds and removal succeeds            | Missing. Revoke/removal failure retains saved record.              |
| Read in flight           | Credential removed/replaced or observed generation changes | Reject stale completion; never relabel it with a newer generation. |

### GitHub observed identity and UI boundary (implicit)

Implementation: [auth session](src/server/github/auth-session.ts),
[credential identity](src/server/github/credential-identity.ts),
[UI boundary](src/ui/github-auth.tsx).
States: unobserved, observation in flight, known identity/generation, unknown
after failure; UI observing, ready, or unavailable.

Invariants: identity observation is single-flight; unchanged fingerprint keeps
its UUID; observed A→B→A yields distinct generations; the first failed observation
invalidates a known generation, repeated failures do not continuously rotate it.
Old generation query results and mutation callbacks cannot populate the new
account's view. Public read completion and write boundaries verify their scope.

| From                     | Event                                   | To and effect                                  |
| ------------------------ | --------------------------------------- | ---------------------------------------------- |
| Any                      | Observe while another observation runs  | Join that observation.                         |
| Known                    | Same credential                         | Same generation.                               |
| Unobserved/known/unknown | Different or newly known credential     | Known; new UUID.                               |
| Known                    | Identity read fails                     | Unknown; rotate once and fail closed.          |
| Unknown                  | Another identity failure                | Unknown; preserve invalidation UUID.           |
| UI ready                 | New generation or disconnected response | Clear/cancel old scope; remount account view.  |
| Public read in flight    | Generation changes before completion    | Reject result; refresh under current identity. |

Existing auth coverage includes
[Linear auth](tests/linear-auth.test.ts),
[GitHub generation](tests/github-auth-session.test.ts),
[identity sanitization](tests/github-credential-identity.test.ts), and both
providers' authorization-scope tests.

## Mutation, retry, and bulk machines

### Request deduplication (implicit)

Implementation: [write guard](src/server/write-guard.ts),
[GitHub call wrapper](src/ui/github-auth.tsx),
[Linear workspace](src/ui/LinearWorkspace.tsx).
States: unseen, running, settled retryable, settled retained, retired retryable,
retired blocked. The full-result cache is bounded; retired payload/auth bindings
remain for this process.

Invariants: one dispatch per ID unless definitely not applied; same ID binds the
same payload and private auth scope even after result eviction; no running or
pending-write entry is evicted. UI failed or unacknowledged attempts retain IDs across provider
remounts/account changes; a changed authorization must reject their reuse. A
definite acknowledgment retires its request ID even if the view changed, so a
later deliberate submission is a new intent.

| From                       | Event/guard                                                   | To and effect                                     |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Unseen                     | New ID, capacity available                                    | Running.                                          |
| Running/retained           | Same ID, payload, scope                                       | Join/replay the existing result; no new dispatch. |
| Any bound ID               | Different payload or auth scope                               | Conflict; no dispatch.                            |
| Running                    | Definite preflight/provider rejection, no mutation progress   | Settled retryable.                                |
| Running                    | Success, ambiguity, unknown failure, or any mutation progress | Settled retained.                                 |
| Retryable                  | Same bound request retried                                    | Running; new dispatch allowed.                    |
| Settled, no pending writes | Capacity pressure                                             | Retired; keep binding and retry eligibility.      |
| Retired blocked            | Retry                                                         | Uncertain/result unavailable; no dispatch.        |
| All entries pending        | New request at capacity                                       | Unavailable; do not evict or dispatch.            |

Protection is process-local, not durable provider idempotency across MCP restarts.
Changing request IDs can bypass deduplication; the UI must therefore distinguish
uncertain application from definite rejection.

### Mutation progress and provider result (implicit product states)

Implementation: [tracking](src/server/write-guard.ts),
[GitHub transport](src/server/github/transport.ts),
[Linear operation](src/server/linear/operation.ts).
Progress is `(pending >= 0, confirmed, uncertain)`. The two flags are monotonic
facts; both may be true after a multi-step operation.

| From                    | Event                         | To and effect                                               |
| ----------------------- | ----------------------------- | ----------------------------------------------------------- |
| Preflight               | Scope/validation fails        | Rejected; no mutation evidence.                             |
| Authorized              | Enter mutation boundary       | Increment pending in child and ancestors.                   |
| Dispatched              | Provider acknowledges         | Set confirmed in child and ancestors.                       |
| Dispatched              | Definite rejection            | No uncertainty flag for this mutation.                      |
| Dispatched              | Lost/malformed/partial result | Set uncertain.                                              |
| Any boundary completion | Postflight scope check        | Preserve progress even if check throws; decrement pending.  |
| Acknowledged            | Detail read succeeds          | Return refreshed issue.                                     |
| Acknowledged            | Detail read fails             | Saved receipt/refresh failure; do not repeat mutation.      |
| Partially applied       | Later step fails              | Partial/uncertain result; preserve every acknowledged step. |

GitHub issue state, GitHub Projects Status, and Linear workflow state remain
separate domains. Linear duplicate-state changes require upstream merge semantics;
invalid team/project/label-group combinations are rejected at provider boundaries.
`expectedUpdatedAt` checks detect already stale input but are read-then-write,
not atomic exclusion against simultaneous external writers.

### Native issue states, labels, and relations (explicit data)

Implementation: [GitHub issue writes](src/server/github/issue-writes.ts),
[Linear issue writes](src/server/linear/issues.ts),
[GitHub presentation](src/ui/github-state.ts), and provider operation schemas.
GitHub issue states are `open/closed`; `all` is only a list filter. State reason
is separate (`completed/not_planned/reopened` on input), and GitHub Projects
Status is a distinct project field. Linear workflow state is a native team state
ID with its upstream type, not a GitHub-style binary state.

Invariants: select existing native fields in the correct scope; preserve provider
semantics/readback rather than infer completion from a label or missing runtime.
GitHub normalizes its accepted state/reason combination. Linear duplicate merge
semantics cannot be implemented by changing workflow state alone. Label group
parents are not applicable labels; single-select siblings need explicit removal.

| From                    | Event/guard                                                               | To and effect                                                                       |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GitHub open             | Close with completed/not-planned choice                                   | Provider returns closed issue and native reason.                                    |
| GitHub closed           | Reopen                                                                    | Provider returns open issue/reopened reason.                                        |
| Linear state            | Choose existing team state, neither current nor requested duplicate merge | Update native state; read back actual result.                                       |
| Linear duplicate type   | Attempt ordinary workflow change                                          | Reject; perform merge-related work in Linear.                                       |
| Labels absent/present   | Add/remove existing non-group label with disjoint changes                 | Apply native addition/removal; enforce explicit single-select replacement.          |
| Relation absent/present | Add/remove valid native parent, child, or dependency                      | Apply provider-native relation; reject invalid scope/self references where checked. |
| Project field           | Select/update field in its actual project                                 | Change project value independently of issue workflow state.                         |

### Bulk members and recovery UI (explicit results plus implicit session)

Implementation: [GitHub bulk](src/server/github/bulk.ts),
[Linear bulk](src/server/linear/bulk.ts),
[GitHub recovery](src/ui/github-bulk-recovery.ts),
[GitHub UI](src/ui/BulkActions.tsx),
[Linear UI](src/ui/LinearBulkActions.tsx).
States: ready, busy, member success, saved/refresh failed, definitely failed,
partially saved, uncertain, checking, recovered. Member execution is sequential;
failure does not roll back earlier members.

Invariants: `retryable => !confirmed && !uncertain` (#121); sibling progress is
isolated. Replaying a fulfilled parent returns its cached batch, including failed
members. Retrying safe failed members creates a new batch restricted to them.

| From                       | Event/guard                                               | To and effect                                                                                         |
| -------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Ready (GitHub)             | Valid selection/action, no overlapping unresolved attempt | Busy; retain request ID.                                                                              |
| Busy member                | Mutation and refresh succeed                              | Success; release completed attempt.                                                                   |
| Busy member                | Saved but refresh fails                                   | Saved receipt; offer read-only refresh.                                                               |
| Busy member                | Definite rejection/preflight failure                      | Safe failure; eligible for targeted retry.                                                            |
| Busy member                | Partial/uncertain application                             | Retain unconfirmed attempt; no fresh automatic replay.                                                |
| Unconfirmed GitHub attempt | Replay exact unchanged ID permitted                       | Reuse old request; no new semantic mutation.                                                          |
| Unconfirmed                | Read-only check                                           | Applied clears attempt; different state permits explicit new change; unavailable retains uncertainty. |
| Some members checked       | Replay would include already resolved members             | Disable broad replay.                                                                                 |
| Safe failures              | Explicit retry failed only                                | New request for only eligible failed targets.                                                         |

Coverage: [write guard](tests/write-guard.test.ts),
[retention](tests/write-retention.test.ts),
[GitHub member outcomes](tests/github-bulk-outcomes.test.ts),
[bulk browser recovery](tests/bulk-recovery-browser.spec.ts), and
[receipt recovery](tests/bulk-receipt-browser.spec.ts).

## Local persistence machines

### Disk record and compare-and-swap (implicit)

Implementation: [store](src/server/state.ts), [schemas](src/shared/state.ts).
States: missing (revision zero defaults), valid revision n, invalid original
bytes, locked, committing, and draft tombstone (null draft at n>0).

Invariants: interprocess lock covers read/check/write; a commit uses private temp
file, sync, and atomic rename; revisions increase on accepted writes; invalid
bytes remain unchanged; deletion persists a revision so stale saves cannot
revive deleted drafts. Draft keys include provider user ownership and issue
scope; ownerless legacy keys remain separate.

| From        | Event/guard                             | To and effect                                                                   |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| Missing     | Read                                    | Return revision-zero defaults.                                                  |
| Valid n     | Write/delete with expected n under lock | Commit n+1; deletion stores null.                                               |
| Valid n     | Write with other expected revision      | Conflict; preserve bytes.                                                       |
| Invalid     | Read/write attempt                      | Storage error; preserve original bytes.                                         |
| Committing  | Temp write/sync/rename fails            | Error; clean temp file; retain prior readable record when rename did not occur. |
| Tombstone n | Stale write using revision <n           | Conflict; do not revive.                                                        |

### Per-key draft disk controller (implicit)

Implementation: [local drafts](src/ui/local-drafts.ts).
States: unloaded, loaded record, serialized action in flight, conflict(remote).

Invariants: actions for a key serialize even after a rejected action; all input
is kept in the UI separately from disk revisions; a lost write acknowledgment
must be read back, never blindly replayed; matching means the complete draft,
including provider fields and comment text.

| From                                | Event                                | To and effect                                                            |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| Unloaded                            | Load/first action                    | Read and validate record; loaded.                                        |
| Loaded                              | Save                                 | CAS from recorded revision.                                              |
| Save acknowledgment missing/invalid | Readback equals attempted full draft | Accept observed saved revision.                                          |
| Save failure                        | Readback differs at newer revision   | Conflict; retain remote and local content.                               |
| Delete acknowledgment missing       | Readback is newer null tombstone     | Accept deletion. Missing revision zero is insufficient evidence.         |
| Conflict                            | Use saved                            | Read latest, return saved content.                                       |
| Conflict                            | Keep local                           | Read latest, then CAS explicit local content.                            |
| Legacy available                    | Explicit import, owned record empty  | Save copied legacy content under owned key; leave legacy file untouched. |

### Draft autosave and recovery UI (explicit)

Implementation: [draft persistence](src/ui/useDraftPersistence.tsx).
States: uninitialized, `idle`, `loading`, `pending`, `saved`, `error`, `conflict`,
`resolving`; optional legacy review and failed-action/choice overlays.

Invariants: per-key versions prevent old completion from replacing new input or
status; a 250 ms timer coalesces typing; flush queues pending saves on view exit;
no unseen saved baseline is silently replaced (#119); errors preserve input;
conflict resolution/import are explicit.

| From          | Event/guard                                   | To and effect                                                              |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| Uninitialized | Load                                          | Loading; capture current local version.                                    |
| Loading       | Success, same version                         | Restore record; saved or idle; mark baseline restored.                     |
| Loading       | User typed meanwhile                          | Keep local input; baseline remains unseen.                                 |
| Any editable  | Type                                          | Pending; increment version and reset debounce.                             |
| Pending       | Timer/flush                                   | Wait for load; compare any unseen saved record, then CAS.                  |
| Save          | Different unseen/remote content               | Conflict; preserve both versions.                                          |
| Save          | Success, still current version                | Saved. Superseded completion cannot overwrite newer input.                 |
| Any action    | Recoverable failure                           | Error with action/choice retained.                                         |
| Error         | Explicit retry                                | Retry the failed load/save/delete/resolution choice.                       |
| Conflict      | Keep local/use saved/import legacy            | Resolving; success returns saved/idle; failure preserves choice for retry. |
| Saved/current | Successful provider action then draft removal | Pending deletion; idle only after observed deletion.                       |

### Settings intent queue and cache (implicit)

Implementation: [settings](src/ui/useSettings.ts),
[GitHub retention](src/ui/useGitHubSettings.ts),
[Linear retention](src/ui/useLinearSettings.ts).
States: idle, debounced intent, queued/in-flight write, failed intent by key;
query loading/fresh/stale/error is an independent dimension.

Invariants: same-key intent replaces a pending timer/failure; different-key
failures remain retryable; each serialized write rereads current disk and builds
a bounded patch; no-op patches skip disk; accepted cache revisions do not decrease
on controller/Symphony publication (#122).

| From           | Event                                | To and effect                                                             |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Idle/debounced | Schedule intent                      | Debounced; coalesce 300 ms by key.                                        |
| Any            | Immediate update/flush               | Queue versioned intent.                                                   |
| Queued         | Previous settles                     | Fresh read, build patch, CAS or no-op.                                    |
| In flight      | Success                              | Cancel older settings query; publish only if revision >= cached revision. |
| In flight      | Failure, still latest intent for key | Retain failed builder and report error.                                   |
| Failed         | Retry                                | Rebase retained builder on fresh settings; new CAS.                       |

## Workspace and asynchronous UI machines

### Host session, source, scope, and selection (implicit)

Implementation: [app](src/ui/App.tsx), [session cells](src/ui/session-state.ts),
[GitHub workspace](src/ui/GitHubWorkspace.tsx),
[Linear workspace](src/ui/LinearWorkspace.tsx),
[presentation cache](src/ui/presentation-cache.ts).
States: waiting for launch, launch error, waiting for settings, settings error,
GitHub/Linear/Symphony workspace; within each, account/project scope, optional
selected issue, list/detail/inline display, and create/edit overlay are orthogonal.

Invariants: host-keyed cells survive provider-view unmount; one QueryClient per
host; launch target/inline selection has defined precedence over remembered
settings; GitHub sessions include auth generation; owned drafts remain distinct
from visible selection. On observed Linear owner replacement, old caches and
completion callbacks must not be reused (#120).

| From                     | Event/guard               | To and effect                                                                             |
| ------------------------ | ------------------------- | ----------------------------------------------------------------------------------------- |
| Awaiting launch          | Valid launch/context      | Load settings, then resolve source and scope.                                             |
| Awaiting launch/settings | Invalid/failed read       | Visible error; settings offers explicit retry.                                            |
| Workspace                | Change provider/scope     | Switch view; retain per-session selection/draft/reading position.                         |
| List/inline              | Select issue/open details | Update presented target and detail selection together.                                    |
| Detail                   | Return/switch issue       | Restore corresponding list or reading position.                                           |
| Same owner               | Refresh fails             | Retain stale data and show failure.                                                       |
| New owner/disconnect     | Identity observed         | Cancel old reads, revoke old cached data/action completions; reconnect/reload explicitly. |

### Queries, pagination, and refresh (implicit shared machine)

Implementation: [GitHub queries](src/ui/github-queries.ts),
[Linear queries](src/ui/linear-queries.ts),
[continuation validation](src/ui/page-continuation.ts),
[automatic demand](src/ui/useIssueListContinuation.ts),
[refresh boundary](src/ui/issue-refresh.ts).
States: pending/no data, fresh data, stale data, fetching, error/no data,
error/stale data, next-page loading, exhausted. Query status and fetch status
are independent. App queries/mutations default to `retry: false`.

Invariants: query keys bind native scope/filter/identity where applicable; missing
continuation with `hasMore` is an error, not an exhausted list; no concurrent
next-page demand; auto pagination is bounded to three continuations beyond the initial page per demand cycle;
failures stop auto demand; larger/failed lists require explicit refresh.

| From                       | Event/guard                                   | To and effect                                               |
| -------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| Pending/stale              | Enabled read                                  | Fetching; background requests use reserved queue policy.    |
| Fetching                   | Success                                       | Fresh; retain validated continuation.                       |
| Fetching                   | Failure                                       | Error; preserve existing data if scope/owner still matches. |
| Fresh with next page       | Near visible bottom, budget available         | Load next; decrement auto budget.                           |
| Next-page load             | Failure                                       | Block automatic demand until explicit retry.                |
| Any list                   | Actual scroll                                 | Renew bounded demand budget.                                |
| Hidden                     | Return visible, stale single page, not failed | Refetch without cancelling an existing read.                |
| Multiple pages/failed list | Return/focus                                  | Keep explicit control; no unbounded automatic reread.       |

### Search, URL lookup, and comment overlays (implicit)

Implementation: [debounced search](src/ui/useDebouncedSearch.ts),
[GitHub URL lookup](src/ui/GitHubWorkspace.tsx),
[Linear URL lookup](src/ui/LinearWorkspace.tsx),
[GitHub comments](src/ui/github-comments.ts), and
[Linear comments](src/ui/linear-comments.ts).
Search states: settled, debouncing, IME composing. URL lookup states: idle,
resolving with request counter, accepted, failed, superseded. Comment state is
loaded pages plus a local acknowledged-change overlay.

Invariants: composition does not trigger intermediate searches; scope changes
immediately use the new scope and reset composition. A late URL lookup cannot
change selection after input/scope/selection changes or unmount. Late comment
continuations cannot replace a newer detail's first page; acknowledged comments
remain visible until the source confirms them or a newer revision supersedes
them. Linear deletion overlays prevent stale pages from resurrecting a deletion.

| Machine/from              | Event/guard                            | To and effect                                                                  |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| Settled/debouncing search | Type, not composing                    | Reset 300 ms timer; then publish current query.                                |
| Search                    | Composition starts/ends                | Pause publication; resume debounce after composition.                          |
| URL idle                  | Explicit open, command allowed         | Increment counter; resolve/read exact native identity.                         |
| URL resolving             | Input/scope/selection changes, unmount | Invalidate counter; late completion has no selection effect.                   |
| URL resolving             | Current result/failure                 | Select and cache exact target, or show error preserving prior selection.       |
| Comment pages             | Detail refresh                         | Replace first page with current detail; retain only still-valid continuations. |
| Comment overlay           | Matching/newer source entry arrives    | Remove confirmed overlay; retain unconfirmed posts/edits/deletions.            |

### Issue editing, comments, creation, and native controls (implicit)

Implementation: [GitHub detail](src/ui/GitHubDetail.tsx),
[Linear detail](src/ui/LinearDetail.tsx),
[GitHub creation](src/ui/GitHubCreateIssue.tsx),
[Linear creation](src/ui/LinearCreateIssue.tsx),
[comment editor](src/ui/LinearCommentEditor.tsx),
[conflicts](src/ui/ConflictPanel.tsx).
States: reading, editing, previewing, submitting, conflict, saved/refresh needed,
failed with input preserved. Preview is an orthogonal presentation state.

Invariants: provider command lock prevents overlapping local mutations; use
native fields, not inferred cross-provider state; submitted input/request IDs
survive unresolved results; successful writes followed by failed readbacks do
not become unsaved errors; stale completion must not clear another issue/owner's
draft. Server expected-update checks and local draft CAS protect different
boundaries.

| From       | Event/guard                     | To and effect                                                              |
| ---------- | ------------------------------- | -------------------------------------------------------------------------- |
| Reading    | Edit/create/comment             | Editing with owned draft/base snapshot.                                    |
| Editing    | Preview toggle                  | Preview/edit; retain identical input.                                      |
| Editing    | Submit while command unlocked   | Submitting; capture payload and request binding.                           |
| Submitting | Conflict                        | Compare current/base/remote; retain input.                                 |
| Submitting | Definite failure                | Editing/error; preserve input.                                             |
| Submitting | Acknowledged, readback fails    | Saved receipt; offer read-only refresh.                                    |
| Submitting | Current-scope successful result | Refresh caches, clear only completed draft, release command lock.          |
| Submitting | Selection changes               | Finish only the original draft/session; preserve the newly selected issue. |
| Submitting | Account generation changes      | Complete original request; suppress old callbacks in the new account.      |

### Menus, dialogs, viewport loads, and image previews (implicit)

Implementation: [single select](src/ui/SingleSelect.tsx),
[multi select](src/ui/MultiSelect.tsx),
[dialog](src/ui/AnimatedDialogBackdrop.tsx),
[near viewport](src/ui/useNearViewport.ts),
[images](src/ui/presentation-images.ts).
These are local presentation machines, independent of provider writes.

Invariants: choose only enabled options; selection and native values agree; closing
animation is inert/hidden to interaction; delayed unmount is cancelled by reopening;
focus returns to a connected opener; image completion belongs to its issue/URL
scope; unsupported/failed previews keep source text usable.

| Machine/from      | Event                   | To/effect                                                                     |
| ----------------- | ----------------------- | ----------------------------------------------------------------------------- |
| Select closed     | Open/search             | Open; filter available options.                                               |
| Select open       | Choose enabled option   | Single: choose and close; multi: update selection and remain open.            |
| Select open       | Escape/outside/disabled | Closed; preserve committed value.                                             |
| Dialog absent     | Open                    | Present/open; capture opener and focus first control.                         |
| Dialog open       | Close                   | Present/closed/inert; unmount after 140 ms or immediately for reduced motion. |
| Dialog closing    | Reopen                  | Open; cancel delayed removal.                                                 |
| Offscreen preview | Near viewport           | Eligible for lazy read; queue/cancel by scope.                                |
| Image unloaded    | Load completes/fails    | Ready/fallback; old scoped result cannot replace a new preview.               |

## Symphony observation machines

Implementation: [runtime contracts](src/shared/symphony.ts),
[HTTP adapter](src/server/symphony.ts),
[queries/grouping](src/ui/symphony-queries.ts),
[navigation](src/ui/symphony-navigation.ts),
[workspace](src/ui/SymphonyWorkspace.tsx),
[connection editor](src/ui/SymphonyConnectionEditor.tsx).

### Runtime status versus observation freshness

Explicit runtime states are `running`, `retrying`, and `blocked`. Absence is
“no active run,” not completion. Arco observes upstream transitions; it never
dispatches, starts, stops, approves, or resumes Symphony work.

Invariants: one row per connection/issue runtime key; runtime status overrides
native work grouping; blocked→attention, other active→working, then configured
review/preparation labels or states, otherwise other. Native issue state remains
separate. Runtime and native query freshness are independent.

| From             | Event                                 | To and effect                                                                                      |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| No snapshot      | Initial read                          | Connecting, then observed snapshot or visible error.                                               |
| Observed         | Poll/manual refresh succeeds          | Replace snapshot; adopt upstream running/retrying/blocked state.                                   |
| Observed         | Refresh fails                         | Stale retained snapshot plus unavailable/error notice.                                             |
| Selected runtime | Row disappears in successful snapshot | Retain selected details with disappearance notice; do not infer completion or share an active run. |
| Visible          | Surface hidden                        | Pause interval polling.                                                                            |
| Hidden           | Visible again                         | Resume runtime polling (5 s) and native polling (30 s).                                            |
| Native read      | Account/workspace no longer matches   | Suppress native context; runtime stays independently visible.                                      |

HTTP reads coalesce by normalized base URL/path; timeout, redirect/auth, rate
limit, malformed/oversized response, and duplicate runtime keys are errors.
Pending entries are removed on settlement so a later explicit read can retry.
Local HTTP must be loopback; remote URLs require HTTPS without credentials,
query, or fragment.

### Native resolution, selection, and connection editing

Invariants: match runtime to native data only inside the configured repository
or Linear connection/workspace/team/project; canonical URL has precedence over
dispatch ID fallback; ambiguous native matches do not resolve. Connection ID,
base URL, binding, and native generation scope the cached detail/selection.
Board/table switch retains selection and filters. Sharing is explicit and uses
the displayed observation, excluding worker paths, hosts, and server URL.

| From              | Event/guard                        | To and effect                                                           |
| ----------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Runtime-only item | Later scoped native page matches   | Enrich selection with native identity; keep panel.                      |
| Native selection  | Runtime appears/disappears         | Resolve by scoped native identity; retain missing selection details.    |
| Connection A      | Choose B/edit URL or binding       | Use B's scoped queries/selection; no cross-connection runtime fallback. |
| Closed settings   | Add/edit                           | Open form with original saved connection baseline.                      |
| Form              | Test valid URL                     | Testing; URL input locked; verified/error belongs to that URL.          |
| Form              | Save, baseline still current       | CAS latest settings; publish monotonic revision; close.                 |
| Form              | Save/remove after baseline changed | Conflict with input retained (#122).                                    |
| Form              | Confirm remove, baseline current   | CAS removal and select remaining/default connection.                    |
| Displayed runtime | Add run context                    | Share once through host context API; never send a chat message.         |

Coverage: [service parsing](tests/symphony.test.ts),
[integration](tests/symphony-integration.test.ts),
[matching/grouping](tests/symphony-work-items.test.ts),
[navigation](tests/symphony-navigation.test.ts),
[browser behavior](tests/symphony-browser.spec.ts), and identity/resolution browser
specs. Fixture tests do not prove a live Symphony deployment or route.

## Shared annotations, host transport, and lifecycle

### Issue presentation assembly (implicit transaction)

Implementation: [MCP assembly](src/server/mcp.ts),
[launch contracts](src/shared/launch.ts),
[presentation tests](tests/issue-presentation.test.ts).
States: validate/deduplicate targets, capture provider generations, fetching,
postflight check, complete presentation, failed without a presentation.

Invariants: fetch exact validated targets; no partial detail set is published;
all reads for one provider/Linear alias belong to a single observed generation;
app-only metadata preserves captured generations for first-connection client
verification; model-facing summaries stay separate from app-only bodies. Generation guards
bind the whole group, in addition to individual read guards (#120).

| From     | Event/guard                                   | To and effect                                                 |
| -------- | --------------------------------------------- | ------------------------------------------------------------- |
| Input    | Valid target list                             | Deduplicate, capture GitHub and each Linear alias generation. |
| Captured | Fetch each exact target                       | Accumulate private details; publish nothing yet.              |
| Fetching | Any read fails or returns wrong identity      | Fail complete request; no partial launch.                     |
| Fetched  | All generations still match                   | Publish complete ordered summary/detail set.                  |
| Fetched  | Reconnect between separately successful reads | Auth error; discard mixed-account presentation.               |

The regression changes the Linear generation between two successful issue
reads. Previously the request returned the mixed set; now no launch/details are
returned. Client-side revocation also prevents an already received old Linear
snapshot from reseeding caches after an observed generation change and
display-mode switch. A newer receipt timestamp does not override a mismatched
generation. A fresh presentation matching the current generation can be used
again; unbound legacy snapshots require a fresh source read after verification.

### Visible host attachment and acknowledgment (implicit)

Implementation: [host adapter](src/ui/host.ts),
[shared context parser](src/ui/shared-context.ts),
[attachment encoding](src/ui/context-attachment.ts).
Parse states: absent, whole issue, valid current annotations, valid legacy
annotations, unsupported/invalid (empty). Update states: idle, pending,
acknowledged, rejected/unconfirmed, superseded by native context change.

Invariants: only remaining visible, valid, uniquely numbered blocks establish
annotations; assistant-only data or persisted snapshots cannot resurrect removed
attachments. One attachment update runs at a time, with no automatic retry.
Actual native removal/replacement wins over an older in-flight acknowledgment.
Legacy migration requires a real host acknowledgment.

| From            | Event/guard                                                 | To and effect                                                                   |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Any attachment  | New native update ID                                        | Reparse actual visible blocks; update context revision.                         |
| Attached        | Native removal                                              | Clear issue, annotations, and snapshot identity.                                |
| Idle            | Explicit share, host API available                          | Pending; capture revision and enter mutex.                                      |
| Pending         | Own echo before matching acknowledgment                     | Accept echo; matching acknowledgment may commit.                                |
| Pending         | Valid matching acknowledgment, no superseding native change | Acknowledged; publish attached context.                                         |
| Pending         | Missing/rejected acknowledgment                             | Error/unconfirmed; do not retry automatically.                                  |
| Pending         | Different native replacement/removal before acknowledgment  | Superseded; retain native state, reject old commit.                             |
| Legacy attached | Open                                                        | One acknowledged migration; repeat only for another replaced legacy attachment. |

### Selection anchors and annotation synchronization (implicit)

Implementation: [selection](src/ui/SelectionShare.tsx),
[annotation hook](src/ui/useSharedAnnotations.ts),
[anchor resolution](src/ui/selection-anchor.ts),
[layout](src/ui/useAnnotationLayout.ts),
[snapshot schemas](src/shared/annotation-state.ts).
States: no selection, captured selection, editing note, hashing/capturing anchors,
persisting snapshot, sharing, validating actual host state, committed,
superseded/error, restoring saved anchors, measuring layout.

Invariants: a ref lock prevents duplicate share clicks; input/note survives failed
save; GitHub scope is rechecked before and after persistence; snapshots use unique
UUIDs and cannot be overwritten with different content; hashes bind anchors to
source content. A stored anchor is decoration, not proof of an attachment.

| From                | Event/guard                                  | To and effect                                                                       |
| ------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| None                | Valid DOM/editable selection                 | Capture text, issue identity, anchor, and optional note.                            |
| Captured/editing    | Share/save/remove                            | Hash/capture anchors; persist a fresh immutable snapshot for nonempty annotations.  |
| Persisted           | Scope/context unchanged                      | Share through host attachment API.                                                  |
| Any pre-share stage | Native context changes or auth scope changes | Abort local commit; synchronize to actual host context.                             |
| Shared              | Actual host annotations and snapshot match   | Commit annotation UI; delete the prior snapshot when clearing the final annotation. |
| Shared              | Host state differs                           | Synchronize to host or report failure, never fabricate success.                     |
| Restore in flight   | Snapshot identity changes/unmount            | Cancel old restoration; ignore late result.                                         |
| Layout in flight    | Annotation array identity changes            | Ignore old measurement.                                                             |

The store retains up to 100 attachment snapshots, each with up to 100 anchor
entries. Identical snapshot writes are idempotent; changing content under an
existing snapshot UUID conflicts.

### Tool request queue (implicit)

Implementation: [queue](src/ui/tool-queue.ts),
[queue tests](tests/tool-queue.test.ts).
States: queued interactive/background, active, settled, aborted before start,
queue closed. Active operations and queue openness are independent.

Invariants: at most two active RPCs, at most one background RPC; interactive FIFO
has priority over waiting background reads; an active request retains its slot
until settlement even if its caller's signal aborts. Closing does not invent a
cancellation acknowledgment for active writes.

| From                     | Event/guard                 | To and effect                                             |
| ------------------------ | --------------------------- | --------------------------------------------------------- |
| Open                     | Enqueue non-aborted request | Queued; drain according to capacity/priority.             |
| Queued                   | Slot available              | Active; remove queued-abort listener.                     |
| Queued                   | Signal abort                | Remove and reject with AbortError; never start.           |
| Active                   | Success/failure             | Settle once, release slot, drain next request.            |
| Open                     | Close                       | Closed; reject queued and future requests.                |
| Closed with active calls | Active call settles         | Settle admitted call normally; do not start waiting work. |

### Server and fixture lifecycle (implicit)

Implementation: [server entry](src/server/index.ts),
[composition](src/server/composition.ts),
[fixture host](scripts/dev-host.mjs).
Server states: booting, connected, input ended/transport draining, cleaned up.
Fixture session states: unallocated, reserved/starting, validated/retained,
failed/unretained, deleted/closed; host shutdown is independent of startup.
Fixture HTTP response states: uncommitted, reading asset, headers committed,
ended. Read failure must be handled before committing successful headers.

Invariants: cleanup runs once; EOF stops input while already admitted operations
can finish; cleanup closes pending OAuth listeners without replaying writes.
Fixture retained plus starting count never exceeds 256 (#123); startup failure
and shutdown close unretained clients and free the reservation.

| From                | Event/guard                                                      | To and effect                                                  |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Booting             | Backend and stdio transport ready                                | Connected.                                                     |
| Connected           | Input EOF/transport close/process exit                           | Cleanup once; accepted work drains as supported by transport.  |
| Unallocated fixture | Admission open and retained+starting <256                        | Reserve capacity before any await; starting.                   |
| Unallocated fixture | At capacity/shutting down                                        | 429/503; no child startup.                                     |
| Starting            | Client connects and fixture validation succeeds, host still live | Retain session; release starting reservation.                  |
| Starting            | Any failure or shutdown                                          | Close unretained client; release reservation in finally.       |
| Retained            | DELETE session                                                   | Remove session, then close client.                             |
| Retained            | Host shutdown                                                    | Close client; retained map is discarded when the process ends. |
| HTTP uncommitted    | Read UI asset                                                    | Reading asset; no status committed yet.                        |
| Reading asset       | Read succeeds                                                    | Commit 200 headers, then end with asset contents.              |
| Reading asset       | Read fails, including during rebuild                             | Commit one 500 response; later requests may retry the read.    |

Existing evidence also covers [native host races](tests/host-context.test.ts),
[shared-context validation](tests/shared-context.test.ts),
[annotation snapshots](tests/annotation-state.test.ts),
[server EOF behavior](tests/server-lifecycle.test.ts), and fixture stream/browser
lifecycle specs. No additional confirmed annotation or attachment defect was
found in the inspected paths.

## Verification and limits

Verification of the final source and rebuilt artifact completed on Linux with
Node.js 24.22.1. Browser runs used the installed system Chromium through an
external Playwright configuration; no environment-specific config was added to
the repository.

| Gate                                                                  | Final result                                                                                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                       | Pass: typecheck, lint, formatting, docs, 78 test files / 1,049 tests passed, build, 77-tool MCP smoke, artifact and extracted-package checks. |
| Browser smoke (`@smoke`)                                              | 25 passed.                                                                                                                                    |
| Account drafts, inline issue tabs, Linear account isolation, sessions | 36 passed.                                                                                                                                    |
| Symphony and creation-draft recovery                                  | 19 passed.                                                                                                                                    |
| This document's Markdown formatting and local link targets            | Pass.                                                                                                                                         |
| `git diff --check`                                                    | Pass.                                                                                                                                         |

The Linear generation follow-up also passed 161 focused SDK, presentation, auth,
authorization-scope, and write-guard tests. Before its fix, the four new SDK
A→B→A cases failed against PR head `ab8dbfed854074af6886031a33da2b0a099de44b`;
two token-refresh controls passed. All six pass with the generation check.

The only skipped test is real macOS Apple Silicon credential-store rotation,
which is gated off on Linux. Package native-module loading passed; this does not
substitute for credential-store operations on the supported target.

An isolated copy of the original source reproduced 16 behavioral failures across
new controller/service/group/capacity regressions, while two controls passed
(matching draft content and an independent bulk-member preflight failure). The
baseline production sources were unchanged; the grouped-presentation test needed
only a test-side optional generation hook. The additional missing-asset regression
also reproduced `ERR_HTTP_HEADERS_SENT` on original source. Browser cases were
separately demonstrated failing before their fixes, including startup mismatch,
late snapshots, account round trips, and stale Symphony Save/Remove.

The new tests deliberately control read/write/credential/startup ordering and
inspect persisted values, source mutations, request counts, and rendered UI.
A successful build alone does not establish these transition contracts.

This review covers authored app and fixture state logic. It does not exhaust all
possible interleavings or validate third-party provider internals, real OS keyring
behavior, actual Codex desktop context synchronization, or a live Symphony server.
Provider conditional writes are not atomic locks; external concurrent issue edits
remain possible. Credential refresh can conservatively invalidate an in-flight
read; explicit retry reads under the current generation. The GitHub checks verify
observed credential generations; they do not atomically pin an external CLI
account across arbitrary unobserved changes. Process-local mutation
deduplication does not survive restart.
