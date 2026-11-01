## Approved issue

Link to the issue and the maintainer comment approving this scope. Pull requests from unapproved contributors are closed automatically—see [CONTRIBUTING.md](../CONTRIBUTING.md) for details.

## Summary of changes

In your own words, explain the problem, what this pull request changes, and why.

## Verification

List the checks you ran and their results, and note any behavior that was skipped or left unverified:

- **Code changes:** Run `npm run check` and `npm run test:browser:smoke`. If the change affects behavior, also run the relevant browser specs.
- **Documentation-only changes:** Run `npm run check:docs` locally and test any commands you modified. CI Quality runs, including manual runs and documentation-only PRs, still execute the browser smoke suite.
- **Full browser validation and releases:** Run full browser validation locally with `npm run test:browser`. Before publishing a release, both a full local browser test run and a manual Quality run must pass on the exact release commit.
- **UI changes:** Include screenshots using fictional or redacted data. Distinguish fixture, native Codex, and live provider evidence.

## Author checklist

- [ ] I understand these changes and can explain how they affect the existing codebase.
- [ ] The changes stay within the scope approved in the linked issue.
- [ ] I have reviewed and verified any AI-assisted work included in this PR.
- [ ] I have removed all credentials, private provider content, and generated artifacts.
