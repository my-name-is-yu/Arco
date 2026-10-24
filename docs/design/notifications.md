# Notification policy

Arco displays a notice when the user needs to act or when the current screen cannot show a complete, reliable outcome. This policy applies to GitHub and Linear, in inline cards and the detail workspace.

## Retained notices

| Situation                       | Required information                                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failure or limit                | What failed, the relevant constraint, and how to retry or correct it; includes authentication, permission, input, upload, and local-storage failures.                                                           |
| Conflict or draft protection    | What changed or which unsaved draft blocks the operation, with comparison, save, or discard actions.                                                                                                            |
| Uncertain or incomplete outcome | Whether a write is confirmed, what could not be refreshed, and how to check the source before resubmitting. A saved receipt remains visible when Linear confirms a write but cannot return the refreshed Issue. |
| Bulk failure                    | The failed Issue identifiers, their errors, and a retry action limited to failed targets. Successful targets remain in internal result bookkeeping and are not resubmitted by that action.                      |
| External authorization pending  | A short instruction to finish authorization in the source application and return to Arco. Authorization failure replaces the waiting instruction.                                                               |

Copy success changes the copy button to **Copied**, without a separate notice. Clipboard failure retains the manual-copy field.

## Removed confirmations

Do not emit ordinary success notices for display-mode changes, opened links or attachments, adding context to the chat, provider saves, label or relationship updates, or account disconnection. Do not show routine local-draft checking, saving, or saved text. Successful bulk rows do not produce a report.

The visible result, current controls, or conversation attachment supplies this feedback. Pending work uses existing button loading/disabled states and skeletons. Field help, empty states, and provider-native property values remain part of the screen rather than completion notices.

## Implementation

- `NoticeValue` accepts only `error` and `info`. Meaningful draft guards use `info`; ordinary success is not an available notice kind.
- Host-action helpers report failures and clear a prior notice when another host action begins. They do not accept success-message arguments.
- Local draft persistence and request deduplication continue to operate without completion text.
- Bulk views keep full operation results for retry selection, while rendering only failures.
- Upload size and file-read failures are explicitly errors; they must not disappear with the removed success path.

## Verification

The implementation was prepared on 2026-10-24 JST against `834507e` plus the working-tree changes. Real provider writes are outside this notification-cleanup check.

- `npm run check` passed type checking, lint, formatting, documentation checks, all 556 unit/service cases, production/fixture builds, 73-tool smoke, and artifact inspection. The existing CSS optimizer warning for `::highlight` remains.
- The full browser run passed 178 of 179 cases in 5.4 minutes. Removing the old success notice exposed a test that checked a disconnection count before its asynchronous response. After limiting the response wait to that case, all 29 Linear browser cases passed together without retries in 1.3 minutes, including late-response gates, disconnection failure/reconciliation, authorization waiting, and mixed bulk outcomes. The complete 179-case suite was not rerun together after that test-only correction.
- Focused regression coverage checks quiet success paths for both providers, required external-authorization instructions, bulk failures with failed-only retries, and draft errors/conflicts without routine status text. Existing receipt, uncertain-write, clipboard, and inline-motion cases remain in the browser suite.
- Manual interaction with the local GitHub fixture opened details, added context, saved a title change, and returned to the inline card. The result appeared in the heading/list/shared-context state, with zero `.notice` or routine draft-status elements. This was a mock host, not the Codex conversation UI.
- Refreshed the existing local plugin with `codex plugin add arco@arco-local --json`. Installed HTML/server bytes matched the candidate build. This establishes the installed artifact, not that an existing Codex card has reloaded it.

| Artifact     | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `arco.html`  | `07d9f77ff9c0b39b09144dad8fd8bd7608828d4d8e457826b04ca242c348bd96` |
| `server.mjs` | `63831c8d6de5803c0ff518be8a80cbcbf8fbcc96ebd31cfe675a55ce5dd441dc` |
