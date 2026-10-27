# Contributing to Arco

This guide keeps contributions focused and reviewable. Read it before opening an issue or pull request.

## Keep the project small

Arco is an issue client inside Codex. GitHub and Linear own the issue records; Codex owns the conversation and model execution. Keep changes within the [requirements](docs/requirements.md).

Solve a concrete problem with the smallest useful change. A new abstraction, dependency, provider, or configuration option needs a reason beyond a possible future use. Cross-provider synchronization, a hosted issue backend, and a separate agent runtime are outside Arco's scope.

## Own what you submit

**You are responsible for understanding and verifying your contribution.** Be ready to explain what it changes, why it belongs in Arco, and how it interacts with the existing code. Changes the author cannot explain may be closed without review.

AI assistance is welcome. Review the output, check its assumptions, and test the result yourself. Do not submit unreviewed agent output, speculative diagnoses presented as facts, or batches of automatically generated issues and PRs.

Write issue descriptions and PR explanations in your own words. If generated analysis is useful, add it as a separate comment clearly labeled as AI-generated, and verify its claims. Write repository documentation, comments, and authored examples in English. Provider content retains its original language; tests may use non-ASCII input to exercise Unicode or input-method behavior.

Keep `docs/` for specifications and contracts. Do not add work logs, test-result snapshots, agent handoffs, or code inventories. Use Git history, source code, and test output for that information; keep setup and contribution instructions in the root guides.

## Start with an issue

Search existing issues first. Use the **Bug report** template for reproducible problems or **Contribution proposal** for a change you want to make. Say whether you want to work on it.

New issues and PRs from unapproved contributors are automatically closed. Maintainers review closed issues and may reopen them; a response or review date is not guaranteed. Repository writers and Dependabot are exempt from the gate.

A maintainer can reply on an issue with `lgtmi` to allow its author to open future issues, or `lgtm` to allow its author to open future issues and PRs. The command must appear at the start or end of the comment. To approve someone other than the issue author, mention them in the comment. These are standing permissions to submit, not approval of every proposed change. The approval record lives on the `arco-contributor-approvals` branch; it does not grant repository write access.

Before opening a PR, agree with a maintainer on the issue's problem and scope. Approval is not a promise to merge the resulting code. Duplicate, out-of-scope, low-effort, or unapproved submissions may be closed without discussion. Repeated disregard for this guide or automated spam may lead to an account being blocked from the repository.

## Make issues useful

Keep the main report short enough to read on one screen. Put only necessary logs or supporting details below it.

- State the problem or proposed change and why it matters.
- For bugs, give minimal reproduction steps and expected versus actual behavior.
- Include OS, architecture, Node.js version, Codex version, and Arco revision when relevant.
- Distinguish fixture behavior, actual Codex behavior, and live provider results.
- Include only relevant, redacted logs or screenshots.

Do not include access tokens, OAuth callback codes, private issue content, or credential-store exports. Follow [SECURITY.md](SECURITY.md) for vulnerability reports.

## Before opening a PR

Use the Node.js version in `.node-version`. Install locked dependencies and the browser needed by Playwright, then run the code checks:

```sh
npm ci
npx --no-install playwright install chromium
npm run check
npm run test:browser:smoke
```

`check` runs static and documentation checks, unit/service tests, builds, MCP smoke checks, and production artifact and npm tarball validation. The browser smoke suite covers critical interactions. Both must pass. Run affected browser specs locally for behavior changes; use `npm run test:browser` when a full regression check is needed. For documentation-only changes, run `npm run check:docs` locally and verify any commands you changed. State exactly what you checked and disclose anything you could not verify.

Pull requests into `main` require a passing Quality check against the latest `main`. Pull requests, including documentation-only changes, and manually dispatched Quality runs run `check` and the browser smoke suite, with a target duration of about three minutes. Pushes to `main` also run Quality except for documentation-only changes. Each run uses one runner with a four-minute job limit, leaving one minute for cancellation and cleanup within the five-minute budget. Browser tests run with four parallel workers and stop on the first failure. CI installs only Chromium's headless shell and retains error context and failure screenshots; detailed traces remain available in local runs. A newer run cancels an older run of the same event type and branch or pull request. The Release workflow has the same four-minute job limit.

Before publishing a release, run the full browser suite locally with `npm run test:browser` and manually run the Quality workflow on its intended branch or tag. Require both to pass for the exact commit being released, and repeat them if that commit changes. Full browser validation does not run in GitHub Actions.

Use `npm run dev` to build and start the fictional fixture host for routine development. `npm run dev:fixture` starts an existing build; rebuild after source changes. Live validation scripts can create or modify provider records; run them only against dedicated resources with explicit authorization. A fixture test does not prove native credential storage, real provider writes, or Codex desktop rendering.

On supported macOS Apple Silicon with an unlocked credential store, run `npx --no-install vitest run tests/linear-native-rotation.test.ts` and require the native rotation case to pass. Store failures fail this check. Other OS/architecture combinations skip that case before accessing credential storage; report those skips without claiming native verification.

## Publishing the plugin

Git tracks source and the npm-backed marketplace catalog. Publish the built plugin as `arco-codex-plugin`; keep tarballs, native binaries, and `dist/` out of Git. The development root package remains private.

On macOS with Apple Silicon, run:

```sh
npm ci
npm run package:plugin
```

This builds and validates the production artifact, packs it into `dist/npm/`, and starts the extracted production server outside the checkout. The package check verifies bundled native module loading and offline MCP tools/resources without installing dependencies or calling providers. It does not verify OS credential-store operations, provider authorization, or Codex desktop rendering. The first prebuilt release supports macOS Apple Silicon only.

Keep the root package version, plugin manifest versions, and catalog's exact npm version aligned on a release branch. Complete the manual Quality run for the exact release commit before publishing. Keep the default branch's catalog on the already-published version until the matching new npm package is available.

To bootstrap a new package name before trusted publishing is available, authenticate with `npm login` and publish its verified tarball from `dist/npm/` using `npm publish <tarball> --access public --ignore-scripts`. A published version cannot be reused.

Before using the Release workflow, create the GitHub `npm` environment with a selected-tag deployment rule matching `v*` and no branch deployment rule. Configure the package's npm trusted publisher using npm 11.15.0 or later, a package maintainer account, and account-level 2FA:

```sh
npm trust github arco-codex-plugin --repo my-name-is-yu/Arco --file release.yml --env npm --allow-publish
```

`--allow-publish` permits the workflow's direct `npm publish`. Confirm the repository, workflow filename, and environment with `npm trust list arco-codex-plugin`. Store no npm token in the repository.

A new trusted publisher must complete its [first successful publication within two days](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry). Run the Quality and Release sequence below for a new version within that window; saving the configuration alone does not validate it. Confirm that the Release workflow published successfully. If the configuration expires, remove it, create a new one, and complete the first CI publication within two days.

For later releases, prepare and validate the release branch, push the matching `v<version>` tag, and manually run the Release workflow on that tag. It requires a successful manual Quality run for the same commit, builds and validates the macOS arm64 package, then publishes the verified tarball using npm trusted publishing. Confirm that the exact version is available from npm before merging the catalog version change into the default branch. This order also applies to the first manual publication.

## Keep PRs easy to review

- Link the approved issue and describe the problem, resulting behavior, and verification.
- Keep each PR to one concern. Leave unrelated refactors, formatting, and dependency updates out.
- Add regression coverage for meaningful behavior changes. Use fictional or redacted data in screenshots for UI changes.
- Preserve native provider semantics. GitHub issue state, GitHub Projects Status, and Linear workflow state are separate values.
- Keep generated `dist/`, test output, local state, credentials, and dependency directories out of commits.

Review decisions remain with the maintainer. Address feedback with explanations and focused changes; do not replace them with an agent transcript.

## License

New contributions are provided under the repository's [MIT License](LICENSE). Preserve third-party license and attribution notices when reusing external material.
