# Reported activity in model-turn headings

A supported model-turn start can show **Reported activity: …** using the assistant's recorded `assistant.intent` statement. This is reported activity, not a verified reason, an inferred purpose or a summary of everything done in the turn. Trace makes no model request to write the heading. The turn identifier, recorded model, source, retained event count and observed completion state remain in the subtitle. End records still have their ordinary completion heading.

Open the turn and choose **View reported activity evidence** to switch to chronological order, open the exact original intent record, focus its disclosure and scroll to it. This works from grouped tools, chronological events and request chapters. Original intent records stay in the timeline; the heading does not change Statistics or invent another event.

## Supported selection

- Use the first complete, nonempty `data.intent` string in retained chronological order within the observed same-agent interval. Later valid statements stay available as original evidence but do not replace the first. Empty, whitespace-only, malformed or truncated intent records are skipped. Equal-time intents use the collector's retained order; no claim is made that the selected statement summarizes the turn.
- Read the exact bounded evidence, not generic `preview`, `content`, tool names or reasoning. The evidence must have matching event ID, `assistant.intent` type, timestamp and source. Missing raw agent ID means main chat; an explicit empty, invalid or oversized agent ID is unavailable. Preserve the exact statement's whitespace and Unicode. The displayed heading, including its label, is bounded to 180 UTF-16 code units with an ellipsis without splitting a surrogate pair; source evidence remains unchanged.
- Require a valid observed turn start and a same-agent intent strictly after its timestamp. If a matching end exists, it must be strictly later than the chosen intent. Accept only valid calendar timestamps with a timezone and at most three fractional-second digits. Unknown, invalid or boundary-tied timing cannot establish a heading: the collector sorts unknown timestamps last, which alone does not prove interval membership.
- Treat loop turn IDs as local boundaries, not session-unique identities. Interleaved agents have separate intervals. Each later start creates another interval even when its loop number is reused. Known steering or queued input preserves the current observed interval without making the input a child of that turn.

## Neutral fallback

Keep **Model turn** (with the retained turn ID when usable) when no usable statement is retained, the start/source/turn ID is unavailable, or history is loading, unavailable, unsupported or has omitted any older records. The history rule is deliberately conservative even for a later apparently complete turn: Trace cannot prove that its first retained statement was the first eligible statement from the full window.

Conflicting starts, a mismatched or invalid-time end, an unknown-source turn boundary or input, an abort, or idle/unknown-delivery input interrupting an open interval withdraw its reported heading. A start conflicting with an already-open same-agent interval also stays neutral. A live interval with a valid start and intent can show a heading before its end arrives; its subtitle explicitly says **End not observed**, never that inference is running. These heading rules do not change the existing temporal indentation or retained Statistics definitions.

Polling reuses each event disclosure, source button and evidence node. A late earlier intent can change the first statement and button target without replacing the button. Canonical history replacing a live record with the same ID refreshes changed evidence, metadata and truncation notice in place, so source navigation shows the canonical record. If a focused source button becomes unavailable because the heading falls back to neutral, focus moves to that turn's retained summary. Heading updates do not resume Follow live.

## Evidence and remaining checks

`test/turn-headings.test.mjs` covers literal field selection, multiple intents, interleaved agents, reused turn IDs, steering/queued input, partial history, ambiguous boundaries, timestamp uncertainty, malformed/truncated records, Unicode and ephemeral live/history reconciliation. `test/app.test.mjs` exercises the actual renderer with a small DOM boundary double for all-view navigation, current target changes, disclosure/focus preservation, canonical replacement and unchanged Statistics.

Native owner checks remain deferred for tonight's authorized batch: reported activity must be visually distinct from completion status; inspect collapsed and expanded turns, all three views, narrow/short panes, enlarged text and long Unicode, keyboard and screen-reader navigation, focus when source availability changes, and live updates while reading. The DOM tests do not establish browser layout or native accessibility acceptance.
