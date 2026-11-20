# Request chapters

Choose **Request chapters** in Trace's View control to browse collapsible chronological intervals under literal recorded-input previews. **Grouped tool calls** and **Chronological events** remain available. Every retained original event appears once inside the chapter view, with its timestamp, source and evidence intact. Interleaved agents stay in order; their placement does not identify which request caused their work.

## Supported host evidence

The installed SDK build `1.0.106-8.unstable.r43566476370.g869eef3` defines these fields in `generated/session-events.d.ts`:

| Field | Meaning used by Trace |
| --- | --- |
| `UserMessageData.delivery` | `idle` starts its own run; `steering` enters an active run; `queued` is processed as its own run afterward. This timing field does not identify whether a person supplied the input. |
| `UserMessageData.interactionId` | Optional interaction identity for the input. |
| `AssistantTurnStartData.interactionId` | Optional interaction identity used to match a queued input to its later start. |
| `turnId` on input and turn boundaries | Loop identifier. Values can repeat across requests; Trace never uses it as a request identity. Turn-end records lack `interactionId`. |
| Event `agentId` | An absent raw field denotes main-chat/session activity; a valid nonempty field identifies a separate agent. Invalid fields become an unknown source. |

Trace accepts only the three delivery values and preserves interaction IDs exactly up to 256 UTF-16 code units. Missing, malformed or oversized values become unknown; clipping an ID could create a false match. Evidence retains the original values within the existing 12,000-code-unit limit. Prompt previews use the existing Unicode-safe 180-code-unit bound and render as literal text, including whitespace. The envelope's `parentId` is never a causal link.

The disposable installed-runtime fixture validates actual idle and queued delivery plus matching input/turn-start interaction IDs against the panel projection. Its immediate-mode send was reported by this runtime as queued. Trace therefore trusts the event's delivery field. Steering is covered by synthetic schema-based unit cases; the runtime fixture did not produce a steering event. See [Copilot integration](copilot-integration.md#recorded-session-evidence) for fixture isolation and limits.

## Interval rules and missing evidence

- Main-chat `idle` input begins an interval at that input record, even when no interaction ID is available.
- Main-chat queued input stays where it arrived. It begins a later chapter only at a main-chat turn start matching its exact interaction ID. The retained input must precede that start, have an unambiguous identity, and not refer to an interaction already observed starting. Duplicate inputs, including an unknown-source input with the same ID, prevent the match. Repeated model turns in that interaction do not create more chapters.
- A queued chapter's preview references the earlier input record. The input is not copied into the later chapter or counted twice. An unmatched queued input is labeled as lacking a linked start in the retained window; Trace does not claim it is still waiting.
- Steering never begins a chapter. Validated steering and queued inputs also leave an existing same-agent model-turn interval intact; the input itself is not indented as model work.
- Missing delivery, uncertain source or missing interaction linkage stays visibly unknown. Such input does not fabricate a new request boundary. Older hosts can show an **Unattributed activity** interval; unknown input inside a known interval warns that later boundaries may be unknown.
- A main-chat or unknown-source interruption stays in its interval and marks the outcome unknown. Later records start an unattributed interval until a supported request boundary appears. A child-agent interruption does not close the main-chat interval.
- The first chapter is marked **Partial first chapter** when history is loading/unavailable, older events were omitted, or its beginning is unknown. If the input ages out of the retained window, its preview and linkage are not kept as an unbounded hidden history.

These intervals use Trace's existing event ordering: recorded timestamps, stable ordering for ties, and missing or unparseable timestamps last. A new chapter is a navigation boundary, not evidence that previous work succeeded or completed. A turn ending establishes only that loop iteration's boundary.

## Counts and reading state

Chapter summaries call the same `summarize()` function as Statistics on exactly their retained original records. They show model turns, tool calls, hook calls and skill loads; events without usable counting IDs are disclosed separately. A start or result alone can contribute a partial call. Counts are not whole-chat totals and are not additive across chapters: a tool or hook call spanning two intervals can count once in each interval but once in Statistics for the full retained window.

Chapters contain chronological event rows rather than grouped tool cards, so a later tool result cannot move across a chapter boundary. Switching views reuses the event disclosures and cached tool cards. Live updates, history reconciliation and retained-event eviction preserve overlapping chapter disclosures and restore focus to surviving evidence or its chapter summary. When chapters merge, the combined interval stays open if any overlapping chapter was open, keeping retained evidence visible even without keyboard focus. Ordinary updates preserve an explicit collapse. If no related content remains, focus returns to the View control. Inspecting a chapter pauses Follow live.

The DOM tests cover identity, collapse state, focus targets, history splits, queued arrivals, view changes and eviction. Native keyboard behavior, screen-reader announcements, narrow/short panes, enlarged text, overflow and live reading position still require owner-performed checks; the DOM double does not establish rendered geometry or native acceptance.
