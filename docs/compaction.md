# Recorded compaction

Open a compaction event, then **Compaction summary and limits**, to read the host's reported result, summary and measurements. The disclosure links its original start and completion evidence without moving either event. It stays with the event across grouped, chronological, request-chapter and agent-lane views. Opening it pauses Follow live; the summary supports keyboard scrolling.

Trace identifies an attempt only from complete matching evidence with the same source and exact `compactionAttemptId`. IDs must be nonblank strings of at most 256 UTF-16 code units. The absent raw source denotes the main chat; malformed or ambiguous sources remain unknown. Time, names and chronological `parentId` links never establish a match.

A start without a matching completion has an unknown outcome and does not imply that compaction is running. A completion without a start can expose its own recorded summary and measurements. Missing IDs remain unlinked. Duplicate starts or completions, and completions ordered before their starts, leave the grouped result unknown. The original events remain inspectable.

## Summary and outcome

The installed SDK's `CompactionCompleteData` describes `summaryContent` as an LLM-generated summary of compacted conversation history. Trace displays the exact retained string, including whitespace, Unicode and HTML-looking text, with its length in UTF-16 code units. It does not render Markdown or execute markup. Empty, missing and nontext summaries receive distinct explanations. The summary does not establish all available context, faithful preservation, instruction compliance or what future turns retain.

The `success` boolean supplies reported success or failure; an absent or malformed value leaves that outcome unknown. The optional `outcome` string is open-ended in the contract. Trace preserves future values literally without interpreting them as a known enum.

The existing evidence ceiling is 12,000 UTF-16 code units per event, within a retained window of at most 300 events. Before interpretation, raw JSON must be complete and match the row's event ID, type, source and timestamp; the success field must agree with its projection. If the JSON was clipped, the summary is unavailable even when a fragment appears before the clipping point. Trace neither repairs that JSON nor reads `checkpointPath` to recover text. This feature adds no stored projection, persistence, export, compaction trigger or model request.

## Comparable measurements

Trace compares `preCompactionTokens` and `postCompactionTokens` only under the recognized `tokenAccountingBasis: local_full_context_estimate`. Both values must be finite nonnegative safe integers. A present `tokensRemoved` must also be valid and agree with their difference. Missing, malformed, unsupported or inconsistent measurements leave the comparison unavailable.

The display labels context-token estimates and their basis. Decreases, increases and unchanged values remain distinct; no memory-retention percentage is calculated. Start-event `currentTokens` and provider usage in `compactionTokensUsed` are not comparison inputs. `tokensRemoved` and `messagesRemoved` are separate reported quantities. Invalid counts are unavailable; when both message counts exist, removed messages cannot exceed `preCompactionMessagesLength`.

## Evidence and remaining checks

The [installed-runtime fixture](../scripts/e2e.mjs) uses SDK/runtime `1.0.106-8.unstable.r43566476370.g869eef3`. Its sixth disposable session performs two fixed local retrieval responses followed by a fixture-only `history.compact` request. The third fixed response supplies a literal Unicode and HTML-looking summary. The request still carries the same `view` and `grep` descriptors, and the fixture returns no tool calls. Actual Trace evidence and the presentation helper agree on the shared attempt ID, exact summary, reported success, outcome and comparable measurements. Token totals are validated from actual output rather than fixed constants. Through the compaction phase, the fixture has made fifteen local responses across six disposable sessions. Later fixture phases are described in Copilot integration. No paid inference or existing user session is used.

Unit and DOM tests cover interleaved sources, partial/conflicting boundaries, missing and invalid IDs, future outcomes, exact/empty/large/clipped summaries, malformed metrics, original navigation, stale source guards, live updates, views, filters, focus, scrolling and retention. Native long-summary scrolling, narrow/short panes, 150% text, keyboard/screen-reader use and live reading position remain owner checks. The authorized issue 22 deferral does not establish native acceptance.

Sources: installed `generated/session-events.d.ts` (`CompactionStartData`, `CompactionCompleteData`) and the checked-in runtime fixture. See [Copilot integration](copilot-integration.md) for host boundaries.
