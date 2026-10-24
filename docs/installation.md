# Installation and updates

Arco is an MIT-licensed source project installed as a local Codex plugin. Official public-directory submission is not part of this installation workflow. The small local catalog in `.agents/plugins/marketplace.json` tells Codex where to find a build.

## Requirements

- A Codex desktop environment with local plugin and interactive MCP UI support, plus the `codex` CLI for the commands below. Conversation sharing requires synchronized OpenAI model-context support with acknowledgement metadata.
- Git, npm, and Node.js `>=24.22.1 <25`; `.node-version` records the development baseline.
- For GitHub: the public [`gh` CLI](https://cli.github.com/) on the desktop app's executable search path, with a valid GitHub.com login.
- For Linear: an OAuth application client ID and a working OS credential store. Linux uses an unlocked desktop Secret Service; plaintext fallback is not supported.

macOS arm64 has native validation evidence. Windows and Linux remain unverified in a native Codex desktop environment. Build on each target OS and architecture because the package includes a native keyring binding. See [platform validation](platform-validation.md).

## Build and install

From a checkout of this repository:

```sh
npm ci
npm run build
codex plugin marketplace add .
codex plugin add arco@arco-local
```

The catalog name is `arco-local`, the plugin name is `arco`, and the catalog's path is `./dist/plugin`, relative to the repository root. Keep the checkout available for later rebuilds. Do not register the Git URL as an immediately installable catalog: `dist/plugin` is generated locally and is not committed.

Codex installs a cached copy. Restart the desktop app and start a new conversation after installation. Run the bundled **Arco setup** skill, or ask Codex to open Arco. The equivalent local-catalog workflow is described in the [official plugin packaging documentation](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually).

## Connect GitHub

Authenticate using the GitHub CLI:

```sh
gh auth login --web
gh auth status
```

Arco uses the existing CLI account and its accessible GitHub.com repositories. It does not create a separate GitHub account or silently change the active CLI login. Organization SSO and repository permissions still apply.

Open **My issues** for an account list; the initial scope is **Assigned to me**. Switch scopes explicitly to see created or mentioned issues or all account repositories. **Project issues** uses a repository selected for that conversation. Pasting an official issue URL can open a specific issue directly.

GitHub Projects operations may require an additional scope:

```sh
gh auth refresh -s project
```

Request that scope only if you intend to use Projects. The setup skill can check connectivity without creating an issue. See [authentication and distribution](auth-distribution.md) for the credential boundary.

## Connect Linear

This source workflow requires an OAuth application client ID that you provide. It does not rely on access to the maintainer's development OAuth application.

1. Create or use a Linear OAuth application that your account and workspace are allowed to authorize. Follow Linear's [OAuth application documentation](https://linear.app/developers/oauth-2-0-authentication).
2. Register the exact callback URL `http://127.0.0.1:53187/oauth/linear/callback`.
3. Open Arco's Linear view, enter the OAuth client ID, and select **Authorize in Linear**.
4. Choose or confirm the workspace during Linear's browser authorization. Back in Arco, verify the connected account and workspace, then select the intended team.

Arco uses PKCE with the `read,write` scopes and stores the access/refresh token pair in the OS credential store. No client secret is entered or bundled. Your Linear application's workspace visibility and authorization settings determine who can connect; source availability alone does not make a private OAuth application available to others.

Disconnecting removes the local credential for that connection. Provider-side revocation is a separate action in Linear. See the [Linear validation record](linear-validation.md) for the historical verification scope.

## Update or remove

Pull source changes, install the locked dependencies, rebuild, and refresh the installed copy:

```sh
git pull --ff-only
npm ci
npm run build
codex plugin add arco@arco-local
```

Commit or otherwise preserve your local changes before updating. Restart the desktop app and use a new conversation to avoid a previously loaded MCP server or UI.

To uninstall the plugin and remove its catalog registration:

```sh
codex plugin remove arco@arco-local
codex plugin marketplace remove arco-local
```

Uninstalling the plugin is separate from removing local settings, drafts, or provider grants. Review [local data storage](local-data-boundary.md) before removing retained data. Disconnect Linear in Arco before uninstalling if you want Arco to remove its stored credential. Shared GitHub CLI credentials are managed through `gh` independently.

## Troubleshooting

| Symptom                               | Check                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Plugin is absent                      | Build first; run catalog and plugin installation from the checkout root; restart the desktop app.                       |
| `node` or `gh` cannot be found        | Ensure the executable is visible in the environment used by the desktop app, not just an interactive shell.             |
| Native keyring load fails             | Reinstall dependencies and rebuild on the target OS/architecture. Do not copy a Mac artifact to another platform.       |
| Linear cannot save a credential       | Unlock or enable the OS credential store. There is no plaintext fallback.                                               |
| Linear callback fails                 | Verify the registered callback and that port 53187 is available; finish another pending authorization before retrying.  |
| GitHub lists no issues                | Verify the current account and selected scope. An empty assigned list does not mean all account repositories are empty. |
| Old behavior remains after rebuilding | Reinstall the cached plugin, restart the desktop app, and open a fresh conversation.                                    |

The [connection guide](connection-verification.md) separates build, MCP startup, provider authorization, and actual desktop UI behavior. For a bug report, include those distinctions and redact sensitive content.
