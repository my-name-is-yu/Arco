# Contributing to Arco

Please read this guide before opening an issue or pull request. It helps keep contributions focused, well-scoped, and easy to review.

## Keep the project small

Arco is an issue client built to run inside Codex. GitHub and Linear own the issue records, while Codex manages the conversation and model execution. All changes must stay within the project's [requirements](docs/requirements.md).

Aim to solve a concrete problem with the smallest useful change. Any new abstraction, dependency, provider, or configuration option needs a clear justification beyond "we might need it later." Cross-provider synchronization, a hosted issue backend, and a separate agent runtime are out of scope for Arco.

## Own what you submit

**You are responsible for understanding and verifying everything you submit.** Be ready to explain what your change does, why it belongs in Arco, and how it interacts with the existing codebase. If you cannot explain your changes, your submission may be closed without review.

### Using AI tools

AI assistance is welcome, provided you review the output, verify its assumptions, and test the results yourself.

- Do not submit unreviewed agent output, speculative diagnoses presented as facts, or batches of auto-generated issues and PRs.
- Write issue descriptions and PR explanations in your own words. If an AI-generated analysis is genuinely useful, post it as a separate comment, clearly label it as AI-generated, and verify its claims first.
- When responding to review feedback, reply with your own explanations and focused changes rather than pasting an agent transcript.

### Language and documentation standards

- Write all repository documentation, code comments, and authored examples in English. (Provider content retains its original language, and tests may use non-ASCII input to test Unicode or input-method behavior.)
- Reserve `docs/` strictly for specifications and contracts. Do not add work logs, test-result snapshots, agent handoffs, or code inventories there—rely on Git history, source code, and test output for those. Keep setup and contribution instructions in the root guides.

## Start with an issue

Search existing issues first to see if your topic has already been discussed. When opening a new issue:

- Use the **Bug report** template for reproducible problems, or the **Contribution proposal** template for changes you want to make.
- Mention whether you plan to work on the change yourself.

### Contributor approval gate

New issues and PRs from unapproved contributors are closed automatically (repository writers and Dependabot are exempt). Maintainers review closed issues and may reopen them, though response and review times are not guaranteed.

Maintainers can grant standing submission permissions by replying to an issue with a command at the very start or end of a comment:

- `lgtmi` — allows the issue author to open future issues.
- `lgtm` — allows the issue author to open future issues and pull requests.

_(To approve someone other than the issue author, the maintainer must mention their username in the comment.)_

These records are stored on the `arco-contributor-approvals` branch. Note that this is only permission to submit—it does not grant repository write access, nor does it approve every proposed change.

Before opening a PR, reach an agreement with a maintainer on the issue's problem and scope. Even then, issue approval is not a promise to merge the resulting code. Duplicate, out-of-scope, low-effort, or unapproved submissions may be closed without discussion, and repeated disregard for this guide or automated spam may result in your account being blocked.

## Writing useful issues

Keep the main description short enough to fit on a single screen, and place any necessary logs or supporting details below it.

- **Be clear:** State the problem or proposed change and explain why it matters.
- **Make bugs reproducible:** Provide minimal reproduction steps along with expected vs. actual behavior.
- **Include environment details:** Share your OS, architecture, Node.js version, Codex version, and Arco revision when relevant.
- **Clarify the context:** Distinguish between fixture behavior, actual Codex behavior, and live provider results.
- **Keep attachments clean:** Include only relevant, redacted logs or screenshots.

**Security note:** Never include access tokens, OAuth callback codes, private issue content, or credential-store exports in issues or PRs. To report a security vulnerability, follow [SECURITY.md](SECURITY.md).

## Development and testing

### Local development

Use the Node.js version specified in `.node-version`. For routine development, run `npm run dev` to build and start the fictional fixture host. (`npm run dev:fixture` starts an existing build without rebuilding, so remember to rebuild after making source changes.)

Keep in mind that fixture tests do not prove native credential storage, real provider writes, or Codex desktop rendering. Because live validation scripts can create or modify real provider records, only run them against dedicated test resources with explicit authorization.

### Pre-PR verification

Before opening a pull request, install locked dependencies and the Playwright Chromium browser, then run the verification suites:

```sh
npm ci
npx --no-install playwright install chromium
npm run check
npm run test:browser:smoke
```

Both commands must pass:

- `npm run check` runs static analysis, documentation checks, unit and service tests, builds, MCP smoke checks, and production artifact/npm tarball validation.
- `npm run test:browser:smoke` covers critical browser interactions.

Depending on your changes, run these local checks:

- **Behavior changes:** Run the affected browser specs locally. Run the full suite (`npm run test:browser`) if your change needs a complete regression check.
- **Documentation-only changes:** Run `npm run check:docs` locally and test any commands you modified.
- **macOS Apple Silicon native credential check:** On supported macOS Apple Silicon machines with an unlocked credential store, run `npx --no-install vitest run tests/linear-native-rotation.test.ts`. The native rotation case must pass (store failures will fail the check). Other OS and architecture combinations automatically skip this case before accessing credential storage; if yours skips it, note that in your PR rather than claiming native verification.

In your PR description, state exactly what you tested and disclose anything you were unable to verify.

### Continuous Integration (Quality workflow)

Pull requests targeting `main` require a passing **Quality** check against the latest `main` branch.

- **Triggers:** The Quality workflow runs `check` and `test:browser:smoke` on all pull requests (including documentation-only PRs), manual workflow dispatches, and pushes to `main` (excluding documentation-only pushes). Newer runs automatically cancel older runs of the same event type and branch/PR.
- **Browser setup in CI:** CI installs only Chromium's headless shell, runs browser tests with four parallel workers, and stops on the first failure. CI retains error context and failure screenshots; for detailed traces, run the tests locally.
- **Timeouts:** The workflow operates on a strict five-minute budget. Checkout and Node setup each have a one-minute limit. Commands share a three-minute deadline (starting before checkout) with a five-second grace period before forced termination. The job itself has a four-minute fallback limit, and failure artifact uploads are capped at one minute to leave time for cleanup. (The Release workflow shares this same four-minute job limit.)

## Keeping PRs easy to review

- **Stay focused:** Limit each PR to a single concern. Leave out unrelated refactoring, formatting tweaks, and dependency updates.
- **Link and explain:** Reference the approved issue, explain the problem and resulting behavior, and detail how you verified the fix.
- **Test and document:** Add regression tests for meaningful behavior changes. If your PR includes UI changes, use fictional or redacted data in your screenshots.
- **Respect provider semantics:** Keep native provider concepts distinct—GitHub issue state, GitHub Projects Status, and Linear workflow state are separate values and should not be conflated.
- **Keep commits clean:** Never commit generated `dist/` files, test output, local state, credentials, or dependency directories.

Final review decisions rest with the maintainers.

## Publishing the plugin

Git tracks the source code and the npm-backed marketplace catalog, while the root development package remains private. The built plugin is published to npm as `arco-codex-plugin`. Never commit tarballs, native binaries, or `dist/` to Git.

### Building and validating the plugin package

The first prebuilt release supports macOS Apple Silicon (`arm64`) only. On an Apple Silicon Mac, run:

```sh
npm ci
npm run package:plugin
```

This builds and validates the production artifact, packs it into `dist/npm/`, and starts the extracted production server outside the repository checkout. It verifies that bundled native modules load properly and that offline MCP tools and resources work without installing dependencies or calling live providers. However, it does not verify OS credential-store operations, live provider authorization, or Codex desktop rendering.

### Pre-release checklist

1. **Align versions:** On your release branch, make sure the root package version, plugin manifest versions, and the catalog's exact npm version all match. (On the default branch, leave the catalog pointing to the previously published version until the new npm package is actually live.)
2. **Verify the exact release commit:** Because full browser validation does not run in GitHub Actions, run `npm run test:browser` locally and manually trigger the Quality workflow on your target release branch or tag. Both must pass on the exact commit being released—if the commit changes, re-run both checks.

### Setting up npm trusted publishing (first-time setup)

Before using the Release workflow, configure npm trusted publishing as follows. Store no npm tokens in the repository.

1. **Bootstrap the package name (if brand new):** To bootstrap a new package name before trusted publishing is available, authenticate locally with `npm login` and publish the verified tarball from `dist/npm/`:
   ```sh
   npm publish <tarball> --access public --ignore-scripts
   ```
   _(Note: Once a version is published to npm, that version number cannot be reused.)_
2. **Configure the GitHub environment:** Create a GitHub environment named `npm` with a selected-tag deployment rule matching `v*` and no branch deployment rules.
3. **Configure npm trust:** Using npm 11.15.0 or later and a package maintainer account with account-level 2FA enabled, register the GitHub workflow as a trusted publisher:
   ```sh
   npm trust github arco-codex-plugin --repo my-name-is-yu/Arco --file release.yml --env npm --allow-publish
   ```
   _(The `--allow-publish` flag permits the workflow to run `npm publish` directly.)_ Verify that the repository, workflow filename, and environment are set up properly by running:
   ```sh
   npm trust list arco-codex-plugin
   ```
4. **Complete the first CI publication within two days:** A newly configured trusted publisher [expires if it does not complete a successful publication within two days](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry)—saving the configuration alone does not validate it. Run the release sequence below for a new version within that window and confirm the workflow succeeds. If the configuration expires before you publish, remove it, recreate it, and complete a CI release within two days.

### Running a release

For all subsequent releases (and for the first CI release after bootstrapping):

1. Prepare and validate the release branch.
2. Push the matching `v<version>` tag.
3. Manually run the **Quality** workflow on the intended branch or tag for that exact commit and wait for it to pass.
4. Manually run the **Release** workflow on the `v<version>` tag. The workflow verifies that the manual Quality run passed for that commit, builds and validates the macOS `arm64` package, and publishes the verified tarball via npm trusted publishing.
5. Confirm that the new version is live on npm, then merge the updated catalog version into the default branch. _(This publication-before-catalog-merge order also applies to the first manual publication.)_

## License

New contributions are provided under the repository's [MIT License](LICENSE). When reusing external material, always preserve third-party license and attribution notices.
