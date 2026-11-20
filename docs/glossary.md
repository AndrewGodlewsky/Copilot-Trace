# Contextual glossary

Open **Glossary** in the footer for eight short definitions: model turn, tool, hook, skill, context, subagent, permission and compaction. Relevant original event details also offer one **Learn about…** button beneath **Understand this step**. The dialog shows a short definition first; **More about this concept** reveals the authored explanation and limits.

The authoritative vocabulary lives in `web/glossary.mjs`. Event explanations consume the same short definitions rather than their legacy event-specific general copy. Unrelated event types keep their existing general explanations. The glossary makes no model calls, external requests or project-file reads.

## Current chat examples

A contextual button prefers its own retained event. The footer entry and concept selector choose the last appropriate event in retained collector order, including records whose timestamp is unavailable. Matching uses exact supported event types, never names, prose or inferred causality:

| Concept | Retained example types |
| --- | --- |
| Model turn | `assistant.turn_start`, `assistant.turn_end` |
| Tool | `tool.execution_start`, `tool.execution_complete` |
| Hook | `hook.start`, `hook.end` |
| Skill | `skill.invoked` |
| Context | `user.message` — an example of supplied input, not the full active prompt |
| Subagent | `subagent.started`, `subagent.completed`, `subagent.failed` |
| Permission | `permission.requested`, `permission.completed` |
| Compaction | `session.compaction_start`, `session.compaction_complete` |

The chosen example keeps its event ID, type, exact source-agent ID, timestamp, evidence text and shortening flag. There must be exactly one retained event with that ID and matching identity. Missing or malformed identity/evidence cannot supply a live example. Shortened evidence remains explicitly marked when opened. If the example disappears or changes while help is open, it becomes unavailable and cannot silently revive when an ID reappears. Choose a concept again or reopen help to select a new example.

When no suitable event exists, the dialog labels its authored illustration **Static example — not from this chat**. New activity does not replace that illustration during reading. Current examples likewise stay fixed until the user chooses again. Both cases remain limited to retained history, not all chat activity.

**Open current chat example** uses the shared original-event navigator and revalidates the frozen identity. It explicitly switches to Chronological events, resets the filter to Everything, opens the original evidence, focuses that event and pauses Follow live. An unavailable example leaves the dialog and reading position unchanged.

## Evidence limits

Definitions describe supported concepts; they are teaching material, not generated explanations or additional host evidence. Hook pipeline records do not prove configured handlers ran. A skill load does not prove compliance or command execution. Permission approval does not prove effects. Supplied context does not establish the active prompt or what the model used. Reported compaction success does not independently prove semantic preservation. Turns and subagent outcomes do not establish correctness of the overall task.

## Interaction and verification

One native modal uses the existing footer panel controller. Close and Escape return focus to the invoking control with scroll prevention. If that control was removed, filtered out or placed inside a closed disclosure, focus returns to the stable footer Glossary button. Ordinary dismissal preserves view, filter, open disclosures and page position. Explicit example navigation suppresses that return so focus remains on the original evidence. An already active panel is not silently replaced. Opening help pauses Follow live; dismissal never resumes it.

DOM-boundary tests cover all concepts, literal Unicode/source labels, current and static examples, exact identity changes, retention eviction, all four views, nested disclosures, filters, live updates and focus ownership. The server allowlists the new module, and asset checks validate it in the packaged directory. These tests do not establish native dialog rendering, keyboard trapping or geometry. Owner checks of narrow/short panes, enlarged text, actual Escape/Close and focus behavior remain pending under the authorized issue-16 UI deferral.
