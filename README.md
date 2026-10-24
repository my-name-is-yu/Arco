# Arco

An MIT-licensed Codex plugin for browsing and editing GitHub and Linear issues, and bringing selected issue context into your conversation.

Arco runs a local Node.js MCP server and an embedded React interface. It connects directly to your issue providers, uses your existing GitHub CLI login, and stores Linear credentials in the operating system's credential store. There is no Arco account or hosted backend.

## What you can do

- Browse personal GitHub issues or choose a repository for a project conversation.
- Work with Linear issues in an explicitly selected workspace and team.
- Read and edit issue content, properties, comments, labels, and supported relationships.
- Manage GitHub Projects fields separately from an issue's open/closed state.
- Show an issue as an inline card or open its full details in a panel.
- Add an entire issue or several numbered selections, with optional comments, to the Codex composer.

GitHub and Linear remain the sources of truth. Arco preserves each provider's native fields and does not synchronize the two services.

## Install from source

You need a Codex desktop environment with local plugin and interactive MCP UI support, the `codex` CLI, Git, npm, and Node.js **24.22.1 or later within Node 24**. The desktop app must be able to find `node` and, for GitHub, the [`gh` CLI](https://cli.github.com/) on its executable search path. The GitHub CLI must support `gh auth token --no-refresh`.

Build on the target OS and architecture: the package includes a native keyring binding and cannot be copied across platforms. Windows and Linux require native validation before support can be claimed. Linear requires a working OS credential store; Linux needs an unlocked Secret Service. There is no plaintext credential fallback.

```sh
git clone https://github.com/my-name-is-yu/Arco.git
cd Arco
npm ci
npm run build
codex plugin marketplace add .
codex plugin add arco@arco-local
```

The local catalog points to generated `dist/plugin/`, so build before installing and keep the checkout for updates. Codex installs a cached copy. Restart the desktop app, start a new conversation, and run Arco's setup skill. Connect the service you want to use; either service can be used independently.

## Connect your providers

For GitHub, authenticate with the CLI:

```sh
gh auth login --web
gh auth status
```

Arco uses the selected GitHub.com account and its existing permissions. For GitHub Projects, review and grant the additional scope with `gh auth refresh --hostname github.com --scopes project`. Open **My issues** for the initial **Assigned to me** list, or **Project issues** to choose a repository for the conversation.

For Linear:

1. Create or use a [Linear OAuth application](https://linear.app/developers/oauth-2-0-authentication) that your account and workspace can authorize.
2. Register the exact callback `http://127.0.0.1:53187/oauth/linear/callback`.
3. Open Arco's Linear view, enter the client ID, and select **Authorize in Linear**. No client secret is needed.
4. Finish browser authorization, verify the connected account and workspace in Arco, and select a team.

Linear tokens are stored in the OS credential store. Your application's access settings determine who can connect; the maintainer's development application is not a shared public connection.

## Update or remove

Preserve local changes before updating, then refresh the source build and installed copy:

```sh
git pull --ff-only
npm ci
npm run build
codex plugin add arco@arco-local
```

Restart the desktop app and start a new conversation to load the update. If native keyring loading fails, reinstall dependencies and rebuild on that OS and architecture. If Linear authorization fails, check the registered callback, available port 53187, and unlocked credential store.

To uninstall:

```sh
codex plugin remove arco@arco-local
codex plugin marketplace remove arco-local
```

Disconnect Linear in Arco first if you want to remove its stored credential. Uninstalling leaves local settings and drafts separate from provider grants; revoke Linear authorization through Linear when needed. Shared GitHub CLI credentials remain managed by `gh`.

## Develop locally

```sh
npm ci
npm run dev
```

The fixture host builds and displays fictional issues without live provider access. It is a browser preview; actual Codex desktop behavior and live writes require separate checks. The build produces `dist/plugin/` for installation and `dist/dev/` for fixture development. Rebuild after source changes; `npm run dev:fixture` starts an existing build without hot reload.

See [CONTRIBUTING.md](CONTRIBUTING.md) for validation commands and contribution policy. Repository documentation, comments, and authored examples are written in English; provider content is displayed in its original language.

## Specifications

- [Requirements](docs/requirements.md)
- [Issue operations](docs/issue-operations.md)
- [Screen behavior](docs/screen-structure.md)
- [Security and privacy](docs/security-and-privacy.md)

## Contributing and support

Start with a short issue and get maintainer approval before opening a pull request. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the scope, quality bar, and AI-assisted contribution policy. For vulnerabilities, follow [SECURITY.md](SECURITY.md).

Arco is an independent project and is not an official OpenAI, GitHub, or Linear product.

## License

Arco's code and documentation are licensed under the [MIT License](LICENSE). Dependencies retain their own licenses; a build generates `dist/plugin/THIRD_PARTY_NOTICES.txt`. Third-party names and any content retrieved from providers remain the property of their respective owners.
