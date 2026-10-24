# Contributing to Arco

This guide keeps contributions focused and reviewable. Read it before opening an issue or pull request.

## Keep the project small

Arco is an issue client inside Codex. GitHub and Linear own the issue records; Codex owns the conversation and model execution. Keep changes within the [product scope](docs/product-scope.md).

Solve a concrete problem with the smallest useful change. A new abstraction, dependency, provider, or configuration option needs a reason beyond a possible future use. Cross-provider synchronization, a hosted issue backend, and a separate agent runtime are outside Arco's scope.

## Own what you submit

**You are responsible for understanding and verifying your contribution.** Be ready to explain what it changes, why it belongs in Arco, and how it interacts with the existing code. Changes the author cannot explain may be closed without review.

AI assistance is welcome. Review the output, check its assumptions, and test the result yourself. Do not submit unreviewed agent output, speculative diagnoses presented as facts, or batches of automatically generated issues and PRs.

Write issue descriptions and PR explanations in your own words. If generated analysis is useful, add it as a separate comment clearly labeled as AI-generated, and verify its claims. Write repository documentation, comments, and authored examples in English. Provider content retains its original language; tests may use non-ASCII input to exercise Unicode or input-method behavior.

## Start with an issue

Search existing issues first. Use the **Bug report** template for reproducible problems or **Contribution proposal** for a change you want to make. Say whether you want to work on it.

**Get explicit maintainer approval on the issue before opening a PR.** Agree on the problem and scope before investing in an implementation. Approval applies to that proposal; it is not a promise to merge any resulting code.

Review is manual. Clear reports and focused proposals are welcome, but a response or review date is not guaranteed. Duplicate, out-of-scope, low-effort, or unapproved submissions may be closed without discussion. Repeated disregard for this guide or automated spam may lead to an account being blocked from the repository.

## Make issues useful

Keep the main report short enough to read on one screen. Put only necessary logs or supporting details below it.

- State the problem or proposed change and why it matters.
- For bugs, give minimal reproduction steps and expected versus actual behavior.
- Include OS, architecture, Node.js version, Codex version, and Arco revision when relevant.
- Distinguish fixture behavior, actual Codex behavior, and live provider results.
- Include only relevant, redacted logs or screenshots.

Do not include access tokens, OAuth callback codes, private issue content, or credential-store exports. Follow [SECURITY.md](SECURITY.md) for vulnerability reports.

## Before opening a PR

Follow the [development guide](docs/development.md). Use the Node.js version in `.node-version` and install locked dependencies with `npm ci`.

For code changes, run:

```sh
npm run check
npm run test:browser
```

Both must pass. For documentation-only changes, check Markdown formatting, relative links, and any commands you changed. State exactly what you checked and disclose anything you could not verify.

Use the fictional fixture host for routine development. Live validation scripts can create or modify provider records; run them only against dedicated resources with explicit authorization. A fixture test does not prove native credential storage, real provider writes, or Codex desktop rendering.

## Keep PRs easy to review

- Link the approved issue and describe the problem, resulting behavior, and verification.
- Keep each PR to one concern. Leave unrelated refactors, formatting, and dependency updates out.
- Add regression coverage for meaningful behavior changes. Use fictional or redacted data in screenshots for UI changes.
- Preserve native provider semantics. GitHub issue state, GitHub Projects Status, and Linear workflow state are separate values.
- Keep generated `dist/`, test output, local state, credentials, and dependency directories out of commits.

Review decisions remain with the maintainer. Address feedback with explanations and focused changes; do not replace them with an agent transcript.

## License

New contributions are provided under the repository's [MIT License](LICENSE). Preserve third-party license and attribution notices when reusing external material.
