# Initial design explorations

Created on 2026-10-22 with four independent image-generation runs. The images are historical concepts, including conceptual host chrome; they are not screenshots of working Arco or proof of Codex support.

The following English briefs summarize the original generation instructions. The original images used Japanese sample text and were retired during OSS documentation cleanup. Current product decisions are in [screen structure](../screen-structure.md); the picture-in-picture concept was abandoned on 2026-10-23.

## Shared visual brief

Create a flat, front-facing desktop UI concept for an issue client inside Codex. Use warm white surfaces, charcoal text, subtle separators, small outline icons, a restrained blue accent, and readable system typography. Avoid decorative dashboards, gradients, and unnecessary cards. Keep provider issue comments distinct from the Codex conversation and use fictional issue data.

Use one sample issue throughout: `yu/Arco #42`, "Add an issue to a conversation", assignee `yu`, label `enhancement`, Project "My work", progress "In progress". The issue describes attaching selected source context while separating selection from message sending. Later product work made the difference between GitHub issue state and Projects status more explicit.

## Wide management view

The generated image was retired; this brief preserves the design exploration.

```text
Compose a 1440 by 1024 desktop concept with a quiet host sidebar and a two-pane issue list/detail workspace. Keep project, repository filter, search, and creation controls compact. The detail should show a readable description, source properties, one provider comment, Add to chat, and a secondary provider link. The host composer stays outside Arco; do not add a second AI chat interface.
```

## Conversation side panel

The generated image was retired; this brief preserves the design exploration.

```text
Recompose the same fictional issue beside an ordinary Codex conversation. Use one readable column in the issue panel rather than shrinking the wide table. Keep an attached-context chip in the host composer, distinguish provider comments from AI chat, and provide a route back to the list and a detail expansion action.
```

## Inline issue card

The generated image was retired; this brief preserves the design exploration.

```text
Place one compact issue result within the normal conversation flow. Show the source identifier, title, status/progress, a short summary, Open details, and Add to chat. Do not include another issue list, full discussion feed, nested reading scroll area, or separate Arco composer. Preserve enough text size for comfortable reading.
```

The current inline implementation includes common property operations beyond this early brief. See the [inline-card record](inline-card-validation-2026-10-24.md).

## Abandoned picture-in-picture concept

The generated image was retired; this brief preserves the design exploration.

```text
Explore a small floating issue companion, approximately 350-380 pixels wide, with identity, progress, a small update indicator, and a route to details. Leave visible conversation space around it and keep the host composer usable. Do not turn it into a full-height side panel, dashboard, or agent monitor.
```

This concept is retained for design history only. It is not an installation target, supported mode, or feature request.
