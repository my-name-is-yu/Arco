# Code Review-inspired design explorations

Created on 2026-10-22 with four independent image-generation runs. These are historical concepts, not actual Codex captures or current feature specifications. Picture-in-picture was removed from Arco's scope on 2026-10-23.

## Reference and intent

Each generation used a supplied Code Review screenshot to study dark surfaces, readable detail content, compact pill controls, quiet dividers, and restrained density. The side-panel, inline, and floating concepts also used the generated management view for consistency.

The briefs below are English summaries, not verbatim prompt transcripts. The original generated images used Japanese sample content and were retired with the third-party reference screenshot during OSS documentation cleanup. Real account photos and pull-request text were not intended as sample data. The fictional issue was `yu/Arco #42`, "Add an issue to a conversation".

The study did not establish that a third-party app can control Code Review's first-party host sidebar. See [reference boundaries](../code-review-reference.md).

## Shared visual brief

Use a front-facing 1536 by 1000 concept, charcoal content around `#181818`, secondary surfaces around `#212121`, soft white text, muted secondary text, and subtle separators. Use system typography, compact neutral or white actions, and small semantic marks. Keep all Arco navigation inside its own app area and the native composer outside it. Add a small "Arco UI concept" caption.

## Wide workspace

The generated image was retired; this brief preserves the design exploration.

```text
Compose a compact vertical issue list beside a broad readable detail pane. Separate content navigation from issue actions, with utilities in a small toolbar. Show the issue's source identifier, native state, title, author, description, acceptance criteria, comments, and secondary properties. Keep GitHub Open/Closed separate from Projects progress. Use fictional data and no additional AI chat interface inside Arco.
```

## Conversation side panel

The generated image was retired; this brief preserves the design exploration.

```text
Keep an ordinary conversation in the main area and one issue in a narrow panel. Reflow properties into the same column as the description. Use a compact toolbar with Add to chat, source navigation, and a route back to the list. Keep the attached issue chip in the host composer, and clearly label source comments.
```

## Inline result

The generated image was retired; this brief preserves the design exploration.

```text
Show a modest inline result card inside a normal conversation. Include native identity, issue state, title, separate Project progress, a short summary, Open details, and Add to chat. Avoid tabs, another sidebar, full discussion history, and inner scrolling. Keep the result visually subordinate to the conversation while preserving readability.
```

The implemented card has since evolved to include common property operations. Use [inline-card validation](inline-card-validation-2026-10-24.md) and current source for that behavior.

## Abandoned floating companion

The generated image was retired; this brief preserves the design exploration.

```text
Explore a small floating companion with issue identity, native state, separate progress, a subtle comment indicator, and a route to details. Keep conversation space visible around every edge and leave the host composer unobstructed. Do not add a second chatbot or dashboard.
```

The brief remains a design-history artifact. Arco no longer exposes this presentation.
