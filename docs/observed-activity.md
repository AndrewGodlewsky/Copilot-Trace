# Observed activity and missing outcomes

Statistics contains an optional **Observed activity and missing outcomes** disclosure. It lists retained permission requests without matching decisions, tool invocation entries without completions, and delegated starts without lifecycle outcomes. Several records can appear together. These are gaps in retained evidence; even an old start-only record does not establish that work is currently running or waiting.

Each item identifies its recorded source. When the original event identity remains usable and unique, a guarded button opens its evidence. Opening one closes Statistics, selects Chronological events, resets the filter and pauses Follow live. Live updates preserve the disclosure, unchanged rows, focus and scroll positions. When an inspected item disappears, focus moves to the list. A button whose supporting item or original event has changed cannot navigate to a replacement with the same ID.

| Label | Required retained evidence | What removes the missing-outcome label |
| --- | --- | --- |
| Permission decision not observed | One complete request with a usable request ID and known source; no conflicting recovery ownership | One decision with the exact same source and request ID. Any recorded call IDs must agree. Approval, denial and cancellation all count as decisions; their effects remain separate. |
| Tool completion not observed | One complete invocation boundary with matching raw/projected call identity and known source | One completion for that exact source and call. Permission decisions do not replace the tool result. |
| Delegated outcome not observed | One complete child start with a known child source and usable spawning call ID | A matching child completion or failure. An explicit `cancelled` completion is distinct from failure; a parent tool result alone cannot settle the child's lifecycle. |
| Activity unknown | Unsupported ownership, unusable source/identity, clipped or mismatched evidence, duplicate or conflicting boundaries | Sufficient unambiguous retained evidence. Trace never chooses the nearest record or another agent's same-name operation. |

Permission requests can stand alone without a retained tool invocation. The request's optional call ID is not required to identify its decision. Missing permission evidence never establishes approval or preauthorization. Denial and cancellation remain visible as context on a tool invocation whose result is absent. A later interruption from the same source adds its original evidence and an unknown-outcome explanation. An interruption has no call ID, so it cannot cancel every outstanding call or prove which ones stopped.

Only retained records are considered. Eviction can remove a start, decision or result, changing what the disclosure can support; it never proves completion. Unknown or shortened histories remain named in the disclosure. An empty list means no unresolved supported boundaries are retained, not that the chat is inactive or successful.

## Event time and feed connection

The toolbar continues to report the event-feed connection separately. The disclosure shows the latest retained host event's timestamp and age, alongside the panel's last successful feed-response time. An HTTP 304 response updates only the feed receipt: no new retained events were received. After a disconnect, the retained activity remains visible with a cached-snapshot warning.

Host timestamps must parse as valid calendar dates and must not be ahead of the panel's clock. Missing, invalid or future timestamps have unknown age. The display uses the last event in retained chronological order, including an unknown-time final record; it does not skip that record to manufacture a more precise answer. Event age describes a timestamp difference, not hidden computation. No elapsed-time threshold diagnoses thinking, failure, stuck work or successful completion.

Age and feed text refresh through the existing poll cadence. There is no additional timer or live announcement region in this disclosure. Closing the page stops polling, releases its rows and rejects late feed responses. Native screen-reader and layout behavior still require owner checks.

## Inspected contracts and runtime coverage

The installed SDK build `1.0.106-8.unstable.r43566476370.g869eef3` declares the relevant fields in `generated/session-events.d.ts`: permission `requestId`, optional tool-call and recovery-owner fields; tool boundary `toolCallId`; child source, spawning `toolCallId`, `parentId` and completion `cancelled`; and `AbortData.reason`. Abort data contains no tool-call ID. The implementation reuses the [action-stage](action-stages.md) permission grouping and [delegation](delegation-handoffs.md) identity checks. It adds no host queries, private process polling, cancellation controls, model calls or transcript persistence.

The disposable runtime fixture checks the helper while the owning client's permission callback is held. Joined Trace observes invocation entry with no result, so the item says **Tool completion not observed** and its permission remains unknown. This installed runtime does not deliver the live `permission.requested` event to the joined observer. History can recover it with `ownerSessionId`, for which Trace has no verified ownership mapping. A fully linked live permission-waiting path therefore remains unsupported on this build; no request is fabricated. Synthetic fixtures cover the declared request/decision schema independently.

The same runtime fixture holds two fixed child responses until joined Trace has observed both distinct child starts and parent invocations. It verifies two delegated missing-outcome items and two tool items with exact original links, then checks that the recorded outcomes remove them. This uses the existing twenty-two fixed loopback responses across eight disposable sessions, without paid inference or existing user sessions.

Unit and DOM fixtures cover exact repeated IDs across sources, overlapping operations, delayed decisions, denial, cancellation, interruption, start-only history, unsupported recovery ownership, conflicting boundaries, duplicate event IDs, eviction, stale links, literal Unicode, invalid/future time, feed loss and 304 recovery, reading state across views, quiet updates and page-close cleanup. Automated DOM tests do not establish rendered geometry or native announcements. Owner acceptance remains pending under the authorized deferral for this run: narrow/short panes, 150% text, keyboard/focus, live reading position, label clarity and quiet screen-reader updates.
