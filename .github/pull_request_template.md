## Approved issue

Link the issue and the maintainer reply approving this scope.

## Change

Briefly explain the problem and resulting behavior in your own words.

## Verification

List the checks you ran and their results. For code changes, include `npm run check` and `npm run test:browser:smoke`, plus affected browser specs for behavior changes. Full browser validation is manual; use `npm run test:browser` locally or **Actions → Quality → Run workflow** when needed, and require a passing full run for the exact commit before publishing a release. Documentation-only changes do not start CI; include local `npm run check:docs` and any command checks. State any skipped or unverified behavior.

For UI changes, include fictional or redacted screenshots. Distinguish fixture, native Codex, and live provider evidence.

## Author checklist

- [ ] I understand the changes and can explain their effect on the existing code.
- [ ] The change stays within the approved issue's scope.
- [ ] I reviewed and verified any AI-assisted work.
- [ ] I excluded credentials, private provider content, and generated artifacts.
