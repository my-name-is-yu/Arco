# GitHub issue and repository discovery

Arco uses the existing public GitHub CLI connection. Personal issue discovery does not require selecting a repository, iterate through every repository, or fall back to unrelated public search.

## Personal account views

`arco_account_issues` reads the native authenticated-account issue feed. It defaults to **Assigned to me** and offers explicit **Created by me**, **Mentioned me**, and **All account repositories** filters. An empty personal list stays empty.

| Input    | Default    | Other values                  |
| -------- | ---------- | ----------------------------- |
| `filter` | `assigned` | `created`, `mentioned`, `all` |
| `state`  | `open`     | `closed`, `all`               |
| `sort`   | `updated`  | `created`, `comments`         |
| `order`  | `desc`     | `asc`                         |
| `page`   | `1`        | Positive native page number   |

Results have `{scope: "account", filter, issues, hasMore, page}`. Each issue retains its repository and number. **All account repositories** follows the authenticated endpoint's access scope; it does not mean every public repository. Created issues can include contributions to repositories outside the explicit repository picker.

Each request reads up to 100 native entries and removes pull requests without changing the remaining order. A full PR-only page can therefore contain no issues and still have `hasMore: true`. A full final page can require an extra empty-page read. The personal feed is not replaced with the search-limited `viewer.issues` or a participation search.

## Summary projection and conditional reads

The account endpoint initially returns its REST response to GitHub CLI, including fields not needed by the viewer. CLI `--jq` projection removes body/detail data before Node parses the summary. It does not remove that data from the initial provider-to-CLI transfer.

Subsequent requests can send `If-None-Match` for the exact endpoint. A validated `304 Not Modified` reuses the matching summaries without a response body. Changed pages return fresh results; connection, permission, malformed-response, or identity errors must not become stale success.

This cache is memory-only, limited to 32 entries / 8 MiB, and bound to a private hash of the active CLI credential checked before and after each request. A changed token invalidates it even if the username is unchanged. The server obtains that identity using `gh auth token --hostname github.com --no-refresh`; the token and hash are neither returned nor persisted. The installed CLI must support that option.

## Repository queries

`arco_list_issues` uses GraphQL issue search with up to 100 summary rows per page. It requests native identity, title/state/update time, author, labels, assignees, and continuation metadata; bodies, comments, reactions, and images are separate detail requests.

Inputs preserve `repo`, `query`, `state`, `sort`, `order`, and numeric `page`, with an optional opaque `cursor`. More results return `nextCursor`. Changing scope/query/order restarts at page 1 without a cursor.

Explicit `sort:` qualifiers, Boolean syntax, parentheses, legacy page-only continuation, and nested fields exceeding the summary query's limits use the existing REST search path to preserve semantics. A failed or partial GraphQL response is an error rather than a silent data-source switch. Repository search retains its distinct 1,000-result cap.

Both personal and repository responses validate native repository and canonical issue URL identity. Opaque GraphQL label IDs in summaries are not substitutes for separately fetched editing metadata.

## Paging and refresh in the viewer

Within 200px of an expanded list's end, scrolling can request the next page. Short or PR-only pages can continue, capped at three additional automatic pages per scroll demand. **Load more** remains available and renews the budget. Hidden and compact lists do not continue automatically; a failed continuation waits for explicit retry.

Counts describe loaded issues. Thirty-second polling and focus refresh run only for a single loaded page. A multi-page view uses explicit **Refresh** to update its accumulated pages, while writes still invalidate relevant data.

The personal feed has no full-text or Project query field. The search box accepts an explicit GitHub issue URL. Repository selection enables native full-text/qualifier search without changing account-filter semantics.

## Repository picker and settings

`arco_repositories({page?})` reads one page of 30 repositories through `GET /user/repos`, ordered by updated time and scoped to owner, collaborator, and organization-member access. Rows contain `id`, `repo`, `url`, `private`, `archived`, and `issuesEnabled`; the response includes `hasMore` and `page`.

Discovery does not trigger per-repository issue reads until scope is selected. Personal preferences store only filter/state/sort/order; repository preferences and chat-specific choices are separate. Issue content is not persisted in those preferences. Missing settings use defaults; invalid settings use the recoverable process described in [Local data](local-data-boundary.md).

## Verification and upstream references

Fixtures cover explicit filters, equal issue numbers across repositories, PR-only pages, continuation, identity validation, credential changes, and error/fixture separation. Live counts are time- and credential-specific and are not a total inventory. See [list validation](github-list-validation-2026-10-24.md), [network validation](github-network-validation-2026-10-24.md), and [implementation status](implementation-status.md).

Upstream contracts: [account issues](https://docs.github.com/en/rest/issues/issues#list-issues-assigned-to-the-authenticated-user), [repository discovery](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user), and [issue search](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests).
