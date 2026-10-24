# GitHub account Issues and repository discovery

Verified: 2026-10-24. These reads use the existing public GitHub CLI authentication. They do not request new authorization, scan repositories individually, or fall back to a public GitHub search.

## Initial account views

`arco_account_issues` reads GitHub's native [`GET /issues`](https://docs.github.com/en/rest/issues/issues#list-issues-assigned-to-the-authenticated-user). Repository input is unnecessary. The default is **Assigned to me**, with explicit **Created by me**, **Mentioned me**, and **All account repositories** choices. An empty personal view remains empty; it never switches to another view automatically.

The input is `{filter?,state?,sort?,order?,page?}`. Filters are `assigned` (default), `created`, `mentioned`, and `all`; state defaults to `open`, sort to `updated`, direction to `desc`, and page to `1`. Sort also supports `created` and `comments`. The response is `{scope:"account",filter,issues,hasMore,page}`. Every Issue retains its native repository and number, even when two repositories use the same Issue number.

**All account repositories** follows the endpoint's visible owned, member, and organization repository scope under the current credential. It is not a search of every public repository. Token selection, repository permissions, and organization authorization still constrain visibility.

**Created by me** may include Issues opened in external open-source repositories. It is not necessarily a subset of **All account repositories**: Arco forwards these distinct native filters unchanged rather than restricting personal views to the discovered repository list.

Each request reads one native page of up to 100 entries. GitHub may include pull requests; Arco removes them without changing the remaining source order. A PR-only full page therefore has `issues:[]` and `hasMore:true`, allowing the next native page. A full final page may require one extra empty-page read. The account feed does not inherit the Search API's 1,000-result cap. Arco keeps the native account endpoint and its explicit scopes instead of replacing them with a search or per-repository scan.

List reads use GitHub CLI's `--jq` projection to keep only the fields required for issue summaries, native repository identity checks, pull-request exclusion, and pagination before the Node process parses the response. Bodies and detail-only data do not enter the list response. This reduces CLI-to-Arco response size; the REST response received by GitHub CLI still includes the body. Issue detail, comments, and image reads retain their separate contracts.

In the expanded viewer, scrolling within 200px of the list's end loads the next page. A short or PR-only page can continue immediately, with at most three automatic additional pages per scroll demand. The `Load more` action is always available when more entries remain and renews that budget. Hidden and compact lists do not automatically continue, and a failed next page waits for an explicit retry. The count shows loaded Issues, not a claimed total.

The 30-second poll and window-focus refresh run only while a single page is loaded. A multi-page list keeps its visible rows and can be updated with `Refresh`; source changes made in Arco still invalidate the relevant data. This avoids rereading every accumulated page every 30 seconds.

The account endpoint has no full-text or Projects query parameter. The search field accepts a native GitHub Issue URL even in account scope and opens its exact repository and Issue. Full-text search is enabled after optional repository selection, using the existing `arco_list_issues` repository search and its native qualifiers. Its [Search API limits](https://docs.github.com/en/rest/search/search#about-search), including 1,000 results per query and incomplete-result handling, remain separate. `involves:@me` is [a participation search](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests#search-by-a-user-thats-involved-in-an-issue-or-pull-request), and is not substituted for either account view.

## Repository picker

`arco_repositories` accepts `{page?}` and calls [`GET /user/repos`](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user) with owner, collaborator, and organization-member affiliations. It returns one page of 30 repositories, ordered by updated time descending:

```ts
{
  repositories: Array<{
    id: string;
    repo: string;
    url: string;
    private: boolean;
    archived: boolean;
    issuesEnabled: boolean;
  }>;
  hasMore: boolean;
  page: number;
}
```

This discovery lists explicit repository access; it does not enumerate unrelated public repositories. Repository narrowing is optional, and pasting a URL remains an optional shortcut. Discovery does not add repository-specific reads until the user selects a scope.

## State and verification

Saved account preferences contain only `filter`, `state`, `sort`, and `order`. Earlier settings migrate to Assigned / Open / Last updated / Descending without changing their revision or other settings. Clearing repository scope keeps registered repositories. No Issue body, title, comment, or independent Issue mirror is stored in these preferences.

The fixture has its own explicitly local feed: #42 is assigned to fixture-user, #42/#41 were created by that user, and #43 contains a source mention. A real authentication failure or empty account feed never returns fixture data.

Historical read-only production smoke on **2026-10-23 at 07:52 JST** used the then-current GitHub service and exactly six GET requests, including connection and repository discovery. It recorded counts only:

| Open Issue view, first page | Issues after PR removal | More native entries |
| --------------------------- | ----------------------: | ------------------- |
| Assigned to me              |                       0 | No                  |
| Created by me               |                      23 | Yes                 |
| Mentioned me                |      0 (one PR removed) | No                  |
| All account repositories    |                       8 | Yes                 |
| Repositories                |         30 repositories | Yes                 |

There were **zero source writes**. No private titles or bodies were logged. Evidence: `dist/dev/github-account-discovery-live.json`. These counts are one authenticated first-page observation, not a total account inventory or native UI verification.

Regressions cover native repository identity, equal Issue numbers across repositories, PR-only pages, pagination beyond the Search API cap, explicit personal filters, discovery flags, unsupported account query rejection, authentication/fixture separation, and settings migration/conflicts. Native MCP registration is also exercised by the existing fixture smoke script.
