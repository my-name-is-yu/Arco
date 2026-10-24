# Connection and launch verification

This guide separates reproducible connection checks from historical observations. It does not establish that another user's accounts, current desktop build, or operating system will behave identically. Start with [Installation](installation.md) and [Authentication](auth-distribution.md).

## Check the runtime first

The production plugin manifests invoke `node` on the host's PATH. Confirm the Node version against [`.node-version`](../.node-version), install dependencies from the lockfile, and build locally. Native keyring binaries are specific to the build OS and architecture.

A successful direct stdio connection proves MCP transport behavior. It does not prove plugin discovery, desktop rendering, composer attachments, or permission to publish in an official directory.

## GitHub connection

Use `gh auth status` to check the account the CLI has selected. Arco uses that CLI connection for explicit REST/GraphQL operations. Missing GitHub Projects scopes are an authorization issue rather than evidence that Projects is unsupported. Additional scopes must be reviewed by the user; Arco does not silently refresh authorization or log out the CLI.

Do not paste token output into diagnostics. The application performs a private transient credential-identity check for conditional cache isolation; no credential or hash belongs in a user-facing verification record.

A connection check is separate from a real read, a real mutation, and a successful read after that mutation. Use a dedicated test issue for opt-in write validation; see [Development](development.md).

## Linear connection

Register an OAuth client and the exact loopback redirect URI, then use Arco's setup flow. Verify completion at each boundary: browser consent, callback receipt, OS credential write, connection identity, and a permitted issue read. A click on an authorization button alone is not evidence that the connection completed.

Exercise refresh and reconnect separately when modifying OAuth code. Use an isolated test credential for native storage checks; do not overwrite a real user's credential as a test fixture. See [Linear validation](linear-validation.md) and [Local data](local-data-boundary.md).

## Protocol diagnostics

After dependencies are installed:

```sh
node scripts/probe-project-context.mjs
npm run build
node scripts/probe-project-context.mjs --production
```

The first command uses a disposable MCP server and isolated Codex data directory. The production form uses the built server with a temporary Arco state directory and existing read-only GitHub CLI connection. These checks do not install the product or start a model turn. Their output marks installed-plugin loading as unverified.

To inspect an already installed Arco plugin through the public app-server protocol:

```sh
node scripts/validate-plugin-host.mjs
```

This script uses the current Codex installation and existing provider connections. It is an opt-in host integration check, not part of an offline fixture suite. It reads launch and connection information; it does not verify desktop rendering or change source issues. Host API changes can require updating the diagnostic script.

## Historical host-Node experiment

On 2026-10-22, the isolated `experiments/host-node-check/` plugin tested a host-supplied Node variable. With the variable inherited, a macOS arm64 app-server process connected and called the probe; without it, that probe failed before initialization. This did not establish that all desktop launches inject that variable.

The completed experiment code has been removed. The production launch configuration uses `node`; it does not require the experimental host variable. This paragraph records the historical result only.

Later checks on 2026-10-23 recorded installed-plugin transport, GitHub and Linear connections, dedicated issue writes, and Linear refresh on macOS arm64. Refer to [implementation status](implementation-status.md), [GitHub validation](github-live-validation.md), [Linear validation](linear-validation.md), and [platform validation](platform-validation.md) for their limits. Historical success is not a current connection test.
