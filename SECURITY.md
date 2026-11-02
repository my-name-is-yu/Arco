# Security Policy

Arco processes issue content and manages provider authorization directly on your machine. Before investigating a security issue, please review our [security and privacy boundaries](docs/security-and-privacy.md) to understand how Arco is designed to operate.

## Reporting a Vulnerability

If you discover a security vulnerability, please allow a private discussion before publishing exploit details:

1. **Use private reporting:** Go to the repository's **Security → Report a vulnerability** tab on GitHub to submit your report privately.
2. **Fallback channel:** If private reporting is unavailable on GitHub, open a brief public issue asking the maintainer for a private contact method. **Do not** include exploit details or sensitive information in a public issue.

### What to Include

Whenever possible, test against the latest source revision and include the exact commit hash in your report. The project does not guarantee a response or maintenance schedule.

Please include the following details in your report:

- **Tested revision:** The affected commit hash.
- **Environment:** Your operating system, architecture, and any relevant configuration.
- **Reproduction steps:** Clear steps to reproduce the issue.
- **Impact and boundaries:** The security boundary you expected to hold and the actual impact you observed.

> **Protect sensitive data:** Always use fictional sample data in your reports. Redact all tokens, OAuth codes, private provider content, and local filesystem details.

---

## Core Security Boundaries

Arco relies on strict boundaries to keep user data and credentials safe. Contributions and security assessments should preserve these boundaries:

- **Secure credential storage:** Store OAuth credentials exclusively in the operating system's credential store. Never introduce plaintext fallbacks or bundle client secrets inside plugin packages.
- **Untrusted provider content:** Treat all issue bodies, comments, and attachments as untrusted data, keeping them strictly separated from agent instructions.
- **Scoped and safe operations:** Limit reads and writes to explicitly referenced provider items. Leave unspecified fields untouched and detect known edit conflicts. If a write's outcome is uncertain, check the provider's current state before retrying.
- **Local data privacy:** Keep drafts and settings on the user's machine. Require explicit user action before sharing context with Codex.
- **Clean production artifacts:** Ensure test fixtures, credentials, and source maps are excluded from production plugin builds.

### Scope and Third-Party Behavior

Provider authorization rules and the host application's security model are managed by their respective projects. When evaluating or reporting an issue, please distinguish between a vulnerability in Arco itself, a permission limitation imposed by the issue provider, and unverified behavior of the host application.
