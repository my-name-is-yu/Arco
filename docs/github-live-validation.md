# GitHub live operation validation

Historical validation record: 2026-10-23 JST. These results are superseded as a release-readiness statement by [implementation status](implementation-status.md). They describe the builds and dedicated test resources used on that date, not a fresh provider check. Current contributor procedures are in [development](development.md).

## Native Issue operations

At 00:03–00:04 JST, the generated production server ran through the official MCP client over stdio. Calls reached GitHub through public `gh api`; they did not write to a browser fixture. The test used dedicated validation Issues, including one newly created child, without modifying unrelated Issues or changing authorization scopes.

All six operation groups and all four cleanup checks passed. Server stderr was zero bytes.

| Operation group      | Observed result                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label definitions    | Created a run-specific label, changed its name/color, applied it, and preserved the existing documentation label                                                       |
| Comments             | Posted one temporary comment; the same `requestId` returned the existing result without a second post; edited by numeric ID, added/removed a reaction, then deleted it |
| Issue reactions      | Added/removed a previously unused type and restored the original reaction-ID set                                                                                       |
| Parent/sub-issue     | Created a child, removed its parent, set the existing parent again, and removed it                                                                                     |
| Dependencies         | Added/read/removed blocking relations in both directions and preserved their native meaning                                                                            |
| Partial bulk failure | Returned a successful close and a missing-Issue failure as separate results                                                                                            |

Both dedicated Issues ended closed. The original Issue retained its label IDs and state. Temporary labels, comments, reactions, and relations were removed; the newly created validation Issue remained closed for traceability.

[`scripts/validate-github-operations.mjs`](../scripts/validate-github-operations.mjs) implements the check. It requires a closed Issue with the validation-title marker and does not automatically retry an ambiguous mutation failure. Same-process request deduplication is not an exactly-once guarantee across processes. This script writes real provider data and creates a validation Issue; keep it outside routine CI and use a dedicated test repository.

The local JSON report records outcomes, created IDs, and cleanup without credentials or full Issue/comment bodies. Such reports live under ignored `dist/dev/` and are not bundled.

## Projects validation

Projects authorization was checked independently from ordinary Issue access. An initial successful read returned empty personal Projects and empty Issue membership, which established authorized access but did not prove field writes.

A later dedicated private Project enabled live field tests at 07:37–07:39 JST. Privacy was explicitly set and read back before adding fields or Issue content. The validation setup created text, number, date, single-select, and iteration fields; creating Project/field definitions is test setup, not an Arco product feature.

| Operation           | Observed result                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Five field types    | Set, read through product tools, clear, read, restore, and read again succeeded for every type                                   |
| Source preservation | All five field restorations and the Issue-content/state/assignee/label preservation check passed; zero stderr bytes              |
| Built-in Status     | Changed Done to In Progress, cleared through the generic field path, restored Done, and read each stage; the Issue stayed Closed |
| Actual Codex UI     | Projects Status changed in the open detail view and provider readback confirmed it; Issue state remained Closed                  |

The Project aggregate returned empty item nodes while Issue membership and direct item-ID reads returned the same non-archived item. The setup guard initially closed the Project early. Recovery reused the exact existing Project/item and retained both failure and recovery evidence. The script now verifies exact item membership for UI preparation and stops on unknown items or an incomplete list instead of changing Project state.

At 07:42 JST, cleanup restored the original Status and temporary title, removed only the created item, and closed the Project while keeping it private. The Issue-content fingerprint matched the original, and membership reads were empty. The private Project and test field definitions remained for traceability.

A later 17:19–17:20 JST run repeated five-type set/read/clear/restore checks with the dedicated test Project and another dedicated Issue. It preserved Issue contents, removed the added item, and restored the Project's private/closed state. Pagination beyond 100 memberships/definitions/values and refusal on second-page failures were fixture checks; hundreds of live field definitions were not created.

## Test tooling and limits

- [`validate-github-project.mjs`](../scripts/validate-github-project.mjs) requires an explicit Project ID, saves/restores existing values, and removes only the item created for that run.
- [`setup-github-project-validation.mjs`](../scripts/setup-github-project-validation.mjs) supports a read-only plan and an explicit execution mode for dedicated private test setup.
- [`cleanup-github-project-validation.mjs`](../scripts/cleanup-github-project-validation.mjs) consumes the setup receipt and rechecks ownership, privacy, dedicated Issue identity, and the exact created item before cleanup.
- Provider-native organization fields, Issue types, and milestone writes were not established by the ordinary-Issue run. A fixture round trip is not evidence of a live write for an unavailable type.
- These stdio/API results do not establish composer mentions, final inline presentation, or every Codex attachment interaction.

API references used for the implementation: [labels](https://docs.github.com/en/rest/issues/labels), [comments](https://docs.github.com/en/rest/issues/comments), [reactions](https://docs.github.com/en/rest/reactions/reactions), [sub-issues](https://docs.github.com/en/rest/issues/sub-issues), [dependencies](https://docs.github.com/en/rest/issues/issue-dependencies), and [Projects GraphQL](https://docs.github.com/en/graphql/reference/projects).
