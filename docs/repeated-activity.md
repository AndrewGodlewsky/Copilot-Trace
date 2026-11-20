# Repeated operations and recorded failures

Open **Statistics → Repeated operations and recorded failures** to inspect exact repeated requests. The disclosure starts collapsed. It shows a neutral invocation count, separate failure counts, the matching rule, recorded arguments and buttons for each occurrence’s original evidence. It does not announce new patterns, move focus, run a tool or take action on the agent.

## Matching rule

Two or more distinct usable call IDs form one pattern when all of these match:

- Exact recorded source ID: main chat and each agent remain separate.
- Exact recorded tool name and supported provider metadata.
- Every recorded argument, with object keys compared in sorted order. Array order, value types, absent fields, null, string whitespace, line breaks, commands, paths and Unicode remain significant. No shell parsing, Unicode normalization or semantic similarity is used.

Ordinary requests reuse Trace’s supported authored contracts for `view`, `grep`, `glob`, `create`, `edit`, `powershell` and `web_fetch`. Provider and implementation remain unknown when no provider metadata was recorded; equal names and arguments do not prove equal implementations. Unsupported arguments or explicit unverified origin/override markers remain unclassified.

MCP requests require complete supported metadata, including an exact `mcpConfigServerName` and server `mcpToolName`. The raw model-facing tool name and all recorded MCP fields also participate in equality. A shared display name, or legacy display-only server identity, cannot merge different providers. MCP arguments are compared as recorded JSON objects; this does not establish the historical tool schema or the arguments’ meaning. Missing metadata differs from present metadata; malformed fields such as null server names are unsupported.

The comparison considers at most the latest 300 supplied retained events. Arguments are limited to depth 12, 512 JSON values and 8,000 serialized UTF-16 code units after key ordering. Requests exceeding a bound remain unclassified rather than being shortened into a matching identity. Raw evidence remains subject to Trace’s existing 12,000-character clipping limit. Unknown and unclassified counts are visible alongside history and retention limits.

## Counts and outcomes

A start and its result count as one invocation. Each invocation needs one complete start, a usable source and call identity, unique event IDs, at most one result, and retained start-before-result order. Duplicate or reused call identities and contradictory boundary order remain unclassified. Timestamp ties keep retained order; absent or invalid times are labeled unknown.

A valid start can still match when its result is absent, clipped, malformed or contradictory. Those cases do not supply a failure count or result link. A valid result must match the original source, call, tool and any provider fields it records; its raw success boolean must agree with the projected boundary. Original arguments remain available separately.

Tool protocol failure and typed process failure have separate counts and can overlap. Process failure requires a unique valid nonzero typed `shell_exit` for a supported ordinary `powershell` request, using the existing validation rules. A tool reporting success can still have a nonzero process exit. An MCP tool named `powershell`, text saying a process failed, contradictory typed statuses or a missing typed status cannot establish a process exit.

Two or more failures of the same kind within a matching pattern are labeled recurring. A later success leaves earlier failures visible and does not prove recovery. Missing results do not mean an operation is still running. Repetition alone does not establish a retry, loop, inefficiency, cause or an agent being stuck.

## Reading and navigation

Counts update from the retained snapshot across all filters and timeline views. Eviction removes expired occurrences; a pattern disappears when fewer than two eligible invocations remain. Surviving pattern disclosures and occurrence controls retain identity across updates, including eviction of the first occurrence. Opening the disclosure pauses Follow live. If focused evidence disappears, focus moves to the retained pattern list without scrolling the timeline.

Original-evidence buttons use frozen snapshots and recheck the exact retained event, invocation and pattern before navigation. A changed, duplicated, evicted or closed-page target is rejected without moving the reading position. A valid explicit navigation closes Statistics, selects the chronological unfiltered view, opens the original evidence and leaves Follow live paused.

No persistence, command execution, model call, file read or inferred retry relationship is added. The view does not show semantic similarity or compare argument differences; original evidence remains the source of the recorded values.

## Verification limits

Disposable helper and DOM fixtures cover exact repetition, repeated failures and success, object key order, nested values, literal strings, source/provider separation, timestamp ties, partial or conflicting boundaries, recursion/size/window limits, eviction, focus, disclosure state, filters, stale links and close cleanup. DOM fixtures exercise reconciliation, not rendered geometry or native screen-reader behavior.

Native checks remain pending under the owner’s explicit overnight UI deferral: collapsed and expanded quietness; narrow and short panes; 150% text; keyboard/focus and overflow; live reading with Follow live paused; and explicit original-evidence navigation. No browser or desktop UI automation was performed.
