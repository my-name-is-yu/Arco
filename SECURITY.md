# Security policy

Arco handles issue content and provider authorization on the user's machine. Review the [security and privacy boundaries](docs/security-and-privacy.md) when investigating a problem.

## Report a vulnerability

Use the repository's GitHub **Security → Report a vulnerability** option when private vulnerability reporting is available. If that option is unavailable, open a minimal issue asking the maintainer for a private reporting channel, without exploit details or sensitive data.

Include the affected commit, operating system and architecture, relevant configuration, reproduction steps, expected security boundary, and observed impact. Use fictional data and redact tokens, OAuth codes, private provider content, and local filesystem details. Please allow a private discussion before publishing exploit details.

Report against the current source revision when possible. There is no guaranteed response or maintenance schedule; include the revision you tested so the report can be evaluated accurately.

## Boundaries to preserve

- Keep OAuth credentials in the OS credential store. Do not add plaintext fallbacks or embed client secrets in a plugin package.
- Keep provider content separate from agent instructions. Issue bodies, comments, and attachments are untrusted data.
- Scope reads and writes to explicit provider references. Keep unspecified fields intact, detect known edit conflicts, and resolve uncertain writes before retrying.
- Preserve the local-data boundary and explicit context-sharing behavior.
- Keep fixture data, credential material, and source maps out of production plugin artifacts.

Provider authorization policies and the host application's own security behavior are controlled by their respective projects. Clearly distinguish an Arco vulnerability from a provider permission limitation or an unverified host behavior.
