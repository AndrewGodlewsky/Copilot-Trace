# Compare tool arguments

Open **Compare arguments** in the footer and choose a first and second invocation. The dialog shows their exact recorded source, call ID, event ID, tool name and available MCP metadata. Both original-argument buttons open the retained raw event. The comparison describes differences between the two choices; their order does not establish a retry sequence or explain why anything changed.

Choices come from up to 300 retained events across all timeline views and filters. They stay fixed while the dialog is open. Close and reopen to choose from the current window. There is no automatic nearest-call selection, execution, shell interpretation, model request, file read, current capability lookup or persisted comparison.

## Compatible inputs and honest limits

Ordinary calls must have the same exact recorded tool name and each match the same authored argument contract already used by Trace: `view`, `grep`, `glob`, `create`, `edit`, `powershell` or `web_fetch`. Required fields, permitted fields, value types and contract constraints are checked. Unknown fields, explicit unverified provider/override markers and unsupported contracts prevent a precise comparison. Provider and implementation identity remain unknown; a matching name does not prove them.

These ordinary contracts support strings, numbers, booleans and selected arrays. They do **not** accept null or arbitrary nested objects. Invalid ordinary fields are reported as an unsupported or differing schema, never silently omitted or coerced.

MCP calls provide a separate, usable **literal JSON comparison**. They require valid recorded MCP metadata with an exact configured server key (`mcpConfigServerName`) and server tool name (`mcpToolName`). The raw model-facing tool name and every supported recorded MCP field must also match, including the difference between absence and presence. A shared provider display name or a legacy display-only server name is insufficient. The dialog explicitly states that the historical tool schema and field meaning are unknown. These are JSON member differences, not verified parameter changes or proof that both calls used the same historical schema. No current catalog is treated as evidence of a past schema.

This literal MCP path supports null and nested JSON through the actual dialog, not only through a low-level diff function. Users may explicitly compare sources such as Main chat and an agent; both exact sources remain visible. The source/call pair must identify two distinct invocations.

Each choice needs a unique retained start and usable source/call/event identity. Unknown sources are labeled Source unavailable, never Main chat. Duplicate starts or results, conflicting tool/provider evidence, reversed boundaries, changed records and duplicate event IDs cannot supply a comparison. A missing result is allowed: this feature compares invocation arguments, not outcomes. A clipped or malformed start, missing argument object, unsupported contract, or incompatible provider leaves a visible limitation. Individually valid retained originals remain accessible when the pair cannot be compared; clipped originals retain their existing clipping notice.

Trace's existing evidence projection removes protected members named `encryptedContent` or `reasoningOpaque`, including such members nested inside arbitrary arguments. A Trace-owned `protectedContentOmitted` boolean marks an event when that projection suppresses a present value; it carries no removed content. A marked invocation cannot supply a precise argument comparison because complete arguments cannot be established. The dialog states that both the comparison and the original retained evidence are incomplete. Original links still expose the safe remaining evidence with a visible omission notice, never the removed values. This rule is conservative: the marker reports event-level omission, not the location or meaning of the protected member. A present nonboolean marker also blocks comparison and labels completeness unknown. The exact-repetition inspector excludes these same incomplete invocations so suppressed differences cannot appear as exact repeats.

## Reading the diff

The rows label **added**, **removed**, **changed** and **identical** values. `Absent` means no member or array index was recorded on that side; `null` is the JSON value. Object keys are compared without regard to order. Arrays compare by index, so an insertion can change later indexes. Empty containers and container-type changes are represented as values; an added or removed container is shown as one value.

Paths use JSON bracket notation: `["a.b"]` is a literal key, while `["a"]["b"]` is nested. Quoted keys, slashes, `__proto__` and `constructor` remain own JSON members. Array indexes appear as numbers, such as `["paths"][0]`. `$` represents the complete empty root object.

Values are JSON representations of the parsed arguments, rendered as text. Strings retain their code points, spaces and line breaks; JSON escapes display newlines and quotes unambiguously. Unicode is not normalized and HTML-like values do not create markup. Original raw evidence preserves the retained event serialization; the diff is not a comparison of JSON formatting or shell semantics.

Input limits are depth 12, 512 values and 8,000 serialized UTF-16 code units after key ordering. Exceeding a limit blocks the diff instead of comparing a shortened input. Existing raw-event clipping remains 12,000 UTF-16 code units. Display limits are 80 rows, 1,000 characters per value and 12,000 combined path/value characters. Counts cover the complete bounded comparison; omitted rows and displayed values are counted explicitly. An omitted value is labeled as omitted, never presented as a complete preview or mistaken for null. Open the originals to inspect retained values beyond the display budget.

## Reading position and lifecycle

The dialog uses the existing native modal, labeled selects, close control and focus-return behavior. Opening pauses Follow live. Choosing calls does not change the timeline view, filter or scroll position. Live updates keep surviving controls and diff nodes in place. Only an explicit original-argument navigation closes the dialog, selects chronological events with Everything visible, opens the raw event and moves focus to it.

Selected records are frozen and checked against the current retained source, call, event, tool, timestamp, raw evidence, shortening metadata and protected-content omission marker. Replacement, duplication, conflict or eviction invalidates the selection and removes the comparison without navigating. A changed omission marker invalidates a selection even when the remaining raw evidence is identical. Invalidation remains in effect if the old record later returns; close and reopen to choose again. Original buttons retain focus and announce unavailability. If focus was inside removed diff content, it moves to the stable diff list. Closing, Escape or page teardown clears local choices, selections and comparison content.

## Verification limits

Disposable helper and DOM fixtures cover ordinary path changes, literal command changes, MCP nested/null changes, own-key paths, key reordering, arrays, Unicode, HTML-like strings, incomplete/invalid contracts, provider identity, bounded input/display, exact original navigation, frozen live choices, all view modes, filtering, stale selections, focus and close cleanup. Protected-member fixtures pass through the actual trace projection and verify the blocked diff, safe remaining original notices and marker-only invalidation. They do not establish rendered geometry or native screen-reader behavior.

Owner-performed native checks remain pending under the explicit overnight UI deferral: comprehension of ordinary versus literal-MCP limits and absent/null/omitted states; narrow and short panes; 150% text; long keys and values; keyboard selection, Escape, focus return and overflow; live reading and invalidation; and both original links. No desktop or browser UI automation was performed.
