---
name: arco-setup
description: "Connect Arco to GitHub or Linear, or troubleshoot an Arco connection error."
---

# Arco setup

Use Arco's bundled MCP tools, with the host's namespace. Explicit user instructions take precedence.

1. Use the service established by the request or conversation. If none is established, ask whether to connect GitHub or Linear. Connect only the chosen service.
2. Check its connection:
   - **GitHub:** `arco_connection`. Arco uses the existing `gh` login. If needed, diagnose with `gh --version` / `gh auth status` and guide `gh auth login --web`. Request `project` scope only for Projects operations.
   - **Linear:** Call `linear_connection` with the known `connectionId`, or omit it for the default. If disconnected, open `arco_open({source: "linear"})` and guide the UI's OAuth flow:
     - Source installations require a Linear OAuth application client ID the user can authorize, with `http://127.0.0.1:53187/oauth/linear/callback` registered. If this configuration is missing, explain what is needed; do not assume the maintainer's development application is available.
     - Select **Authorize in Linear** and confirm the workspace in Linear. Then verify the connected account/workspace and select a team in Arco.
     - `linear_auth_*` tools are app-only.
3. After authorization, recheck the connection. Discover repositories with `arco_repositories`, or workspace/teams with `linear_scopes`. Keep the intended scope explicit; ask if ambiguous.
4. When needed, read the requested issue or one list page in that scope. Report the account, scope, and what was verified. An empty list does not justify widening scope. A successful read does not prove write access.

If tools are unavailable, check that Arco is installed and enabled in a local desktop conversation. If the server fails to start, check the package's Node requirement and build OS/architecture. Diagnose startup failures separately from provider authorization errors.

Never expose tokens, request client secrets, use plaintext credential storage, log out shared CLI accounts, or create source records to test setup.
