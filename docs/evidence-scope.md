# Evidence scope

Trace describes retained evidence, not a complete session or the model's full context. Open **Scope and limits** above the timeline or **Count scope** beside Statistics totals for the same current explanation. Healthy snapshots keep this help collapsed. Degraded summaries name the relevant limit, and the Statistics preview identifies partial or stale counts.

## History and event-feed state

| State | What the interface establishes |
| --- | --- |
| History loading | Available history is still loading. Live events may already be retained. |
| History ready | Available history was read; selected event types and retention limits still apply. Zero retained supported events is not proof that nothing happened. |
| Earlier history unavailable | Reading earlier history failed. Retained live facts remain available. |
| Event API unsupported | The host did not expose the session event API. This differs from a temporary history-read failure. |
| History status unknown | A missing or unrecognized history status makes no completeness claim. |
| Disconnected, no snapshot | Counts are unavailable, shown as a dash rather than a complete zero. |
| Disconnected, previous snapshot | Retained records remain visible, with explicitly stale counts and an explanation that the previous snapshot may be out of date. |

When no events are retained and history is loading, unavailable, unsupported or unknown, operation totals are unavailable. With retained records, Trace still shows the counts supported by those records. A history or transport failure never removes an observed failure or replaces missing completion with success or guaranteed running.

Connection state comes from event-feed responses, not a view or filter rerender. A successful 200 refresh or 304 revalidation clears stale context. A 304 updates only scope and status text; it does not rebuild the timeline. Capability snapshots have their own refresh time and stale state, independent of event-feed connectivity and history status.

## Limits and missing evidence

Trace keeps at most **300 recent supported events** in memory. The omitted count describes older supported events removed from that window, not all unobserved host activity. Each raw evidence record is bounded to **12,000 UTF-16 code units**, preserving surrogate pairs. Emoji may use two code units; this is not a byte count. No collection or persistence limits were increased.

Scope help distinguishes omitted older events, Trace-clipped raw records, unlinked invocation identities and unavailable event IDs. Unsupported event types and rejected malformed records may be absent; Trace cannot infer how many were missed. Records lacking usable turn, hook or tool identities do not contribute to those invocation totals. Retained evidence and reported outcomes remain available even when reliable linking is impossible.

Individual cards keep their precise reasons and original-evidence controls: missing boundaries, conflicting results, unknown permission, limited requests, unknown resource coverage and explicitly reported host-shortened output. Raw clipping and host shortening remain separate. The same history wording appears in action-stage, tool-extent and retrieval explanations. Healthy event rows receive no repeated observer warning.

Trace does not recover hidden context or unrecorded reasons. Chronology does not establish causality. Scope text contains fixed explanations and bounded counts, never raw diagnostic errors, credentials or private record values. Chat content remains in memory; transcript export and persistence are not added.

## Validation and remaining acceptance

`test/evidence-scope.test.mjs` covers all history states, unrecognized status values, empty snapshots, retention overflow, Unicode clipping and malformed identities using disposable collector fixtures. `test/app.test.mjs` exercises the actual polling load/error path with a DOM double: initial failure, failure after data, offline filter/view changes, 304 and 200 recovery, and stable disclosures, focus, scroll and Follow state. Existing tests cover source navigation, failures, missing boundaries, live reconciliation and eviction.

These automated tests do not establish native rendering or assistive-technology behavior. Owner acceptance remains deferred for this iteration: quiet healthy and clear degraded states, narrow/short panes, 150% text, keyboard focus and disclosures, and reading position during live updates. No browser or desktop UI automation was performed.
