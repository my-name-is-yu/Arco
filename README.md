# Arco

Arco is an MIT-licensed Codex plugin that lets you browse and edit GitHub and Linear issues alongside your chat, and pull selected issue passages directly into your conversation context.

[Install](#install)

## Keep issues beside the conversation

Browse and compare issue cards right inside your chat, then open any issue in the side panel to see the full details.

![Browse inline issue cards in Codex and open the selected issue in its side panel](assets/readme/issue-tabs.gif)

_This clip shows Arco in Codex using fictional demo issues. Typing is sped up 4×; waiting and some scrolling are also sped up._

## Install

### Prerequisites

- A Codex desktop environment that supports local plugins and interactive MCP UIs
- The `codex` CLI, Git, and npm
- **Node.js 24** (`24.22.1` or later within the 24.x release line), available on the Codex desktop app's `PATH`
- **For GitHub:** The [`gh` CLI](https://cli.github.com/) on the desktop app's `PATH`, using a version that supports `gh auth token --no-refresh`
- **For Linear:** A working OS credential store (Arco does not fall back to storing credentials in plaintext)

The prebuilt npm package is built for **macOS on Apple Silicon**. Node.js and the GitHub CLI must be installed separately.

### Option 1: Prebuilt plugin

Install the prebuilt `arco-codex-plugin` package through Arco's marketplace:

```sh
codex plugin marketplace add my-name-is-yu/Arco
codex plugin add arco@arco-marketplace
```

The GitHub repository provides the marketplace catalog, while npm delivers the compiled plugin and its native credential-storage binding. Installing the prebuilt plugin does not compile code from source or run npm lifecycle scripts.

### Option 2: Build from source

If you are installing from source, you must build the plugin on the target OS and architecture. The build bundles a native keyring binding that cannot be copied across operating systems or architectures. (Note: Windows and Linux builds require native testing before support can be claimed, and Linux requires an unlocked Secret Service.)

```sh
git clone https://github.com/my-name-is-yu/Arco.git
cd Arco
npm ci
npm run build
codex plugin marketplace add ./dist
codex plugin add arco@arco-local
```

Running `npm run build` outputs the plugin to `dist/plugin/` and generates a local marketplace catalog at `dist/.agents/plugins/marketplace.json` pointing to `dist/plugin/`. Build before installing. Keep your local checkout so you can pull and rebuild when updating.

### Finish setup

Both installation methods install a cached copy of the plugin into Codex. Once installed:

1. Restart the Codex desktop app and start a new conversation.
2. Run Arco's setup skill.
3. Connect GitHub, Linear, or both—each provider works independently.

## Connect your providers

### GitHub

Sign in with the GitHub CLI:

```sh
gh auth login --web
gh auth status
```

Arco uses your active `github.com` account and its existing permissions. If you want to work with GitHub Projects, review and grant the additional `project` scope:

```sh
gh auth refresh --hostname github.com --scopes project
```

In Arco, open **My issues** to see the initial **Assigned to me** list, or **Project issues** to pick a repository for the current conversation.

### Linear

1. Create or use a [Linear OAuth application](https://linear.app/developers/oauth-2-0-authentication) that your account and workspace are allowed to authorize. (Who can connect depends on your OAuth app's access settings; the maintainer's own development app is not shared publicly.)
2. Register `http://127.0.0.1:53187/oauth/linear/callback` as an exact callback URL.
3. Open Arco's Linear view, paste in the OAuth app's **Client ID**, and click **Authorize in Linear**. You do not need a client secret.
4. Complete the authorization flow in your browser, confirm the connected account and workspace in Arco, and select a team.

Linear tokens are saved in your OS credential store.

> **Note on upgrading older Linear sign-ins:** The first time an updated version of Arco writes to an older Linear credential, it adds a private grant ID to the stored record. Normal token refreshes keep this ID, while reconnecting replaces it. Older versions of Arco that enforce the previous credential format cannot read this updated record, so you may need to reconnect Linear if you downgrade.

## Features

Arco runs locally using a Node.js MCP server and an embedded React interface. There is no Arco account or hosted backend—it connects directly to your issue trackers, uses your existing GitHub CLI session, and stores Linear tokens in your operating system's credential store.

GitHub and Linear remain the single sources of truth. Arco preserves each provider's native fields and does not sync data between the two services.

### Bring the right context into chat

Highlight passages across multiple issues and collect them into a numbered attachment beside your next prompt.

![Add selections from two issues to a grouped context attachment and prepare a message in Codex](assets/readme/share-context.gif)

### Edit where you read

Update issue descriptions in Markdown and change labels without leaving the issue workspace.

![Edit an issue's Markdown body, save changes, and update its labels](assets/readme/edit-issue.gif)

### Work with Linear's own fields

View Linear issues and update their native workflow states and priorities directly.

![Update a Linear issue's native workflow state and priority](assets/readme/linear-workflow.gif)

_The context clip shows Arco in Codex with fictional demo issues. The editing and Linear clips use sample data in a browser preview. Typing is sped up 4×; waiting and some scrolling are also sped up._

## Update, troubleshoot, or uninstall

### Updating

**Prebuilt installation:**

```sh
codex plugin marketplace upgrade arco-marketplace
codex plugin add arco@arco-marketplace
```

**Source installation:**

First, preserve any local changes, then pull and rebuild:

```sh
git pull --ff-only
npm ci
npm run build
```

_One-time migration:_ If you previously registered the repository root with `codex plugin marketplace add .`, point the marketplace to `./dist` instead:

```sh
codex plugin marketplace remove arco-local
codex plugin marketplace add ./dist
```

Finally, update the installed copy:

```sh
codex plugin add arco@arco-local
```

After updating either installation type, restart the Codex desktop app and open a new conversation.

### Troubleshooting

- **Native keyring fails to load:** On a prebuilt install, verify you are on a supported OS and architecture (macOS on Apple Silicon). On a source install, reinstall dependencies (`npm ci`) and rebuild on that exact machine.
- **Linear authorization fails:** Make sure the callback URL matches `http://127.0.0.1:53187/oauth/linear/callback` exactly, local port `53187` is free, and your OS credential store is unlocked.

### Uninstalling

If you want to remove your stored Linear token from the OS credential store, disconnect Linear inside Arco before uninstalling. Uninstalling leaves local settings and drafts separate from provider grants; revoke Linear authorization through Linear when needed. Your GitHub CLI login remains managed by `gh`.

**Prebuilt installation:**

```sh
codex plugin remove arco@arco-marketplace
codex plugin marketplace remove arco-marketplace
```

**Source installation:**

```sh
codex plugin remove arco@arco-local
codex plugin marketplace remove arco-local
```

## Local development

To run the local browser preview with fictional sample issues (without live provider access):

```sh
npm ci
npm run dev
```

The build outputs the installable plugin to `dist/plugin/` and the fixture preview to `dist/dev/`. Re-run the build after changing source files; you can also run `npm run dev:fixture` to serve an existing build without hot reload. Because the fixture host runs in a standard browser, always test actual Codex desktop behavior and live API writes separately.

- See [CONTRIBUTING.md](CONTRIBUTING.md) for validation commands and contribution guidelines.
- See [Publishing the plugin](CONTRIBUTING.md#publishing-the-plugin) for npm package validation and release setup.

Repository docs, code comments, and authored examples are written in English, while content from GitHub and Linear is displayed in whatever language it was written in.

## Specifications

- [Requirements](docs/requirements.md)
- [Issue operations](docs/issue-operations.md)
- [Screen behavior](docs/screen-structure.md)
- [Security and privacy](docs/security-and-privacy.md)

## Contributing and support

Please open a short issue and get approval from the maintainer before submitting a pull request. Read [CONTRIBUTING.md](CONTRIBUTING.md) for project scope, quality expectations, and the policy on AI-assisted contributions. To report a security vulnerability, follow [SECURITY.md](SECURITY.md).

Arco is an independent project and is not an official OpenAI, GitHub, or Linear product.

## License

Arco's source code and documentation are released under the [MIT License](LICENSE). Third-party dependencies keep their respective licenses; building the project generates `dist/plugin/THIRD_PARTY_NOTICES.txt`. Third-party names and any content fetched from connected providers belong to their respective owners.
