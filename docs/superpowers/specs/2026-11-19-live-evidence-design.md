# Live evidence proof of concept

The owner approved a live timeline for the current chat, with expandable recorded evidence and general explanations. Its purpose is to help people learn how the model and harness work. The owner explicitly chose recorded evidence only and a small first version.

## Approach

Use the existing canvas, attached session's event subscription and history, and a read-only loopback snapshot endpoint. Plain browser JavaScript polls once per second with a revision validator. This keeps the existing dependency-free deployment. SSE would add connection lifecycle work without a meaningful benefit for this proof of concept. AI-generated interpretations are deferred by the owner.

## Behavior

- Read available history from this chat while subscribing immediately to live events; reconcile overlap by event ID.
- Show user messages, model turn boundaries, assistant messages/intent/reported reasoning, tool starts/results, skills, subagents, hooks, permissions, compaction and errors when supplied by the host. Skip token deltas, checkpoint copies and canvas bookkeeping.
- Keep chronological steps, with visible turn dividers. A native expandable row shows event type, recorded IDs and evidence as literal text. Tool results correlate to retained starts by agent and tool-call ID. Missing context is labeled, never invented.
- Skill origins come only from the recorded trigger. General explanations describe the event's role; they never claim to reconstruct the model's decision or treat chronological adjacency as causation.
- Indicate loading, history failure, disconnected polling, empty state and retention limits. Preserve expanded items during updates. Provide a follow-live control; reading an expanded item stops following.
- Keep at most 300 supported events per panel, with at most 12,000 UTF-16 code units of evidence per event (truncation labeled). History retrieval itself is the SDK's full-history API. No new persistence, inference, exports, project reads or cross-chat access.
- Closing a panel unsubscribes and closes its server. Parent session/model/permissions remain host-owned.

## Verification

Unit tests cover history/live overlap, failure, cleanup, missing metadata, recorded skill triggers, subagent correlation, bounded retention and HTTP authorization. The installed-runtime fixture must prove history and live events reach the endpoint using disposable sessions and local fixtures only. Separate owner-performed acceptance checks `/trace`, live updates, expanded evidence, narrow/short layout, keyboard focus, light/dark and close/reopen. UI automation is excluded by the owner's global preference.

Version 0.1.2 includes synchronized metadata, release notes, independent review and packaging. The existing publication gate requires recorded owner UI acceptance before a verified push to main.
