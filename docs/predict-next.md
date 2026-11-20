# Predict next action

The optional **Predict next action** disclosure above View offers **Start live prediction** and **Start retained practice**. Choose Read / search, Edit, Execute, Delegation or Response, then select **Record prediction**. Feedback names one observed category and its literal source evidence. A different observation is a comparison with your expectation, not a wrong answer, confidence score or proof that only one action was reasonable.

**Skip** abandons a live prediction or reveals one retained practice outcome without comparing a choice. **Try another** starts another choice in the same practice view. **Return to live view** returns to the most recent captured snapshot; its separate **Follow live when returning** checkbox defaults off. None of these controls pauses, interrupts or otherwise controls the host agent. There are no model calls, scores, rankings, durable learner data, transcript exports or private-session reads.

## Deterministic categories

The pure `web/learning.mjs` classifier inspects one event at a time. Eligible types are `tool.execution_start`, `subagent.started` and `assistant.message`, with the proposal exception below. It requires complete bounded JSON whose raw ID, type, source and timestamp match the projected event. `truncated` and `protectedContentOmitted` must both be explicitly false. Missing or malformed source identities, protected omissions, clipped JSON and unsupported contracts resolve **unknown**, with the original available evidence. Text and Unicode are rendered literally.

| Observed category | Supported evidence |
| --- | --- |
| Read / search | A tool start satisfying the existing `view`, `grep`, `glob` or `web_fetch` argument contract. |
| Edit | A tool start satisfying the existing `create` or `edit` argument contract. |
| Execute | A tool start satisfying the existing `powershell` argument contract. Shell text remains opaque. |
| Delegation | A `subagent.started` record with a usable child source, exact spawning call ID and complete recorded agent name/display-name/description fields. |
| Response | A nonempty assistant text message with a usable message ID, no chunk or phase metadata, and absent or empty `toolRequests`. |
| Unknown | An eligible record that cannot establish one of these categories. This ends the attempt without comparing the choice. |

The tool categories reuse the exact required and optional argument checks documented in [requested operation categories](operation-categories.md). They describe requested semantics, never verified implementation, approval, execution or effect. Invocation-specific MCP metadata prevents falling through to a familiar tool name: generic MCP service interaction has no exercise category. Explicit unsupported origin/override metadata also stays unknown. Tool names, current catalogs and later child metadata never supply missing historical evidence.

`task` invocations have no supported standalone exercise contract and resolve unknown. The later subagent-start event can independently establish delegation when it is the next eligible record for an attempt. No metadata from that later event is borrowed to classify an earlier task invocation.

A complete assistant message with a nonempty supported `toolRequests` array is ignored, so its proposal is not counted again as an invocation. Each supported proposal has a usable call ID and name plus object arguments. Malformed or unsupported proposal shapes remain unknown. Any chunk or phase field makes the message unknown, including a last chunk: Trace does not infer a complete response or reconstruct earlier chunks. Hook, permission, turn, skill, reasoning, result and other noneligible boundaries are ignored. Unsupported streaming deltas are already excluded by the Trace projection.

## Live observation boundary

`trace.mjs` adds content-free Trace-owned metadata, not SDK fields or causal relationships:

- `snapshot.liveReceipt` is a monotonic nonnegative safe integer for accepted supported live records after history becomes ready. Exhaustion makes it `null`; it never wraps.
- Each entry has `observation: { source, receipt }`. Canonical history is `source: 'history', receipt: null`. A callback received while history is loading is `source: 'live', receipt: null`; it was observed live but cannot establish a new post-baseline action. Post-ready callbacks use `source: 'live'` and the new receipt.
- Retained duplicate IDs and unsupported/checkpoint records do not increment the cursor. History reconciliation preserves canonical history provenance. The existing 300-event retention and bounded evidence remain in force; no unbounded receipt or identity log is added.

Starting the exercise freezes the displayed evidence. Recording a live choice first awaits any pending/coalesced poll, then explicitly makes another read-only poll for a fresh ready baseline. Every record fetched during this arming phase is excluded. Only receipts strictly after that baseline can answer the prediction. This is a prediction of the next record newly observed by Trace after the boundary, not a claim that the choice preceded host execution or an event already displayed.

The resolver validates the cursor, unique IDs and receipts, history state and omission count, then checks that every post-baseline receipt is retained without gaps. It sorts by receipt, ignores noneligible records and resolves exactly the first eligible event. A later event in the same batch cannot replace it. Previously visible IDs, unsafe counters, malformed provenance, unavailable history, a receipt gap, increased omissions or disconnect make the attempt unanswered/unknown. Reconnection does not revive it. No eligible record leaves the attempt visibly waiting without a verdict; the user can skip or leave.

Host timestamps are a separate ordering. A late callback with an earlier or tied timestamp can be the next received event. Feedback names its receipt and baseline; the timeline still orders displayed records by their recorded timestamps. On resolution, live practice reveals only that one source record alongside up to 299 prior displayed records. Other buffered live events remain hidden until returning live. This avoids pulling neighboring records or future metadata into the exercise. No new write endpoint, host pause or permission decision is introduced.

## Retained practice and isolation

Retained practice makes a separate immutable copy of at most 300 retained records and shows the prefix before its first eligible event. Each choice reveals exactly the next eligible record and the preceding noneligible records, then stops. Skip reveals the same next boundary without a prediction. No-next-event and ambiguous retained identities remain unanswered/unknown. The UI explicitly calls this rehearsal: the user may already have seen the original records, and it does not claim a prediction preceded them.

All timeline views, filters, navigation, Statistics, glossary examples, claim/result links and argument comparisons read the displayed snapshot. Existing dialogs close on entering or leaving practice; frozen glossary/comparison selections are cleared. Current capability and instruction catalog sections are hidden, their cached content and inspectors cleared, and pending reads invalidated/aborted. Stale inspector controls cannot restore those captures during practice. Those sections return empty on exit and require an explicit new refresh.

The poller continues updating a separate live snapshot. It never replaces the immutable replay prefix. Follow live stays off and disabled during practice; the explicit return choice determines whether following resumes. Page close invalidates arming work, drops practice/live state and stops polling and catalog readers. Practice is local to this panel and is not a playback engine, example library or persistence feature.

## Verification and remaining acceptance

`test/learning.test.mjs` covers history/buffered/live provenance, duplicates, delayed/tied timestamps, protected omissions, supported/unknown categories, proposals/chunks/phases, batches, no-next-event, unsafe boundaries, receipt gaps, eviction, disconnect and immutable replay. `test/app.test.mjs` uses the existing DOM boundary double for coalesced-poll races, fresh baselines, one-result feedback, all four views, cached inspectors and pending reads, prefix Statistics/glossary/comparison content, ignored hook/compaction boundaries, skip, return-follow choice, unknown source labels, reading position and close races. These tests do not establish native layout or screen-reader behavior.

The installed-runtime fixture verifies real historical/live log provenance and arms while a fixed local response is held, then resolves its first eligible subscribed message. It uses the same 22 local responses and eight disposable sessions, with no paid inference or existing user sessions. See [Copilot integration](copilot-integration.md) for the inspected SDK/runtime and evidence limits.

Owner UI acceptance remains explicitly deferred for the November 20, 2026 overnight run. Pending checks: understanding the receipt boundary and unknown feedback; answer leakage through adjacent views; narrow/short panes and enlarged text; keyboard/focus and screen-reader access; live reading during arming/feedback; and the explicit return-to-live Follow choice. Independent review, full automated verification, packaging and publication remain required; the issue stays open until manual acceptance is recorded.
