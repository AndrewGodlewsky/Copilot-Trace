# Understand this step

Open an event to see three short sections: **What happened**, **What the recorded result means**, and **What remains unknown**. These are authored, deterministic explanations of recorded fields. They do not call a model or reconstruct hidden reasoning. **General definition** keeps the existing event explanation available on demand. **Recorded evidence** opens the original retained event text, with its shortening notice when applicable.

Event type, recorded time and source remain visible. The explanatory text distinguishes a reported fact from its general meaning and limits. Assistant activity, messages and exposed reasoning are statements, not independently verified reasons or results. Unknown event types receive neutral copy rather than inheriting a meaning from a familiar prefix.

## Supported records

All 22 currently observed event types have specific explanations:

| Records | Meaning and limits |
| --- | --- |
| User input | Input supplies a request or context. Exact `idle`, `steering` or `queued` delivery, when supported, explains delivery rather than proving that the assistant read or acted on it. |
| Assistant turn start/end | One iteration starts or ends. This does not establish completion of the user’s task. |
| Assistant intent/message/reasoning | Reported activity, a response or host-exposed reasoning text. Claims, causes and internal decisions remain unverified. |
| Tool invocation start/result | A start records an invocation entering the runtime. It can precede permission evaluation even when the operation is denied, so it does not prove execution. A result’s exact Boolean `success` field is a reported operation outcome, not proof that the user’s task succeeded. |
| Skill load | Instructions or context were loaded. An exact known `trigger` is the host’s attribution, not proof of compliance or which instruction caused a choice. |
| Subagent start/completion/failure | A delegated agent starts or has a reported outcome. A completed event’s exact Boolean `cancelled` field distinguishes recorded cancellation from completion without cancellation. If absent, cancellation status stays unavailable; neither outcome verifies the delegated result. A failure event is a host report, not a root-cause diagnosis. |
| Hook start/end | Configured automation starts or reports a result. Exact Boolean `success` gives a reported outcome, not proof of effects on later actions. |
| Permission request/decision | A request is not approval. A recognized decision kind records permission, refusal or cancellation; approval is not proof of execution. An absent or unrecognized decision source cannot identify a person, even when the result kind contains `user`. A recognized source is displayed as recorded attribution, not independent evidence of human interaction. |
| Compaction start/result | Context reduction starts or reports a result. The event type alone does not mean successful compaction; only an exact Boolean `success` supplies the reported outcome. Later context and behavior remain unverified. |
| Session error/info/warning/abort | Host reports remain distinct from task results, root-cause diagnoses and proof of recovery. An interruption does not identify its initiator. |

## Field validation and partial evidence

The event type supplies a short boundary description. Additional outcome or attribution details require complete evidence of at most 12,000 characters, valid JSON with object data, and matching event ID, type, source and recorded timestamp. IDs retain the collector’s bounds; an unknown source cannot validate raw outcome details. Projected `success`, `trigger` and `delivery` must agree with their raw fields before being used. Strings that resemble Booleans, unknown enum values, mismatched identities, malformed JSON and shortened evidence do not supply these details.

Permission decisions recognize the SDK’s `approved`, `approved-read-only-for-session`, `approved-for-session`, `approved-for-location`, `cancelled`, `denied-by-rules`, `denied-no-approval-rule-and-could-not-request-from-user`, `denied-interactively-by-user`, `denied-by-content-exclusion-policy` and `denied-by-permission-request-hook` kinds. Recognized sources are `assisted_approval`, `human_response`, `host_policy`, `unattended_fallback` and `authorization_carry_forward`. Future values keep the unavailable/unrecognized fallback and remain inspectable in literal evidence.

Missing outcomes do not mean work is still running. A retained result may lack its start, and a retained start may lack its result; these explanations do not infer a complete lifecycle from one event. They do not use result prose, neighboring events, display names or chronology to invent a cause or outcome. No additional transcript storage, host API or model work is introduced.

## Live behavior and verification

The renderer keeps the three explanation paragraphs, both nested disclosures and the original evidence node. Canonical history replacing a live event with the same ID refreshes text and metadata in place, preserving disclosure state, evidence focus and reading position. Grouped, chronological, chapter and agent-lane views reuse those nodes. Source links and meaningful-event navigation open the retained original evidence; normal polling does not open a closed disclosure.

Synthetic tests exercise all event types, reported success/failure, missing outcomes, cancellation, permission attribution, malformed/shortened/conflicting evidence, unknown types, Unicode and markup. Tests also execute the real renderer with a small DOM boundary double to check same-ID updates and retained focus/disclosure identity in all views. They do not establish native rendering or screen-reader behavior.

For the owner-authorized overnight run, manual acceptance remains pending: novice readability, useful explanatory limits, larger text, narrow and short panes, nested-disclosure keyboard and screen-reader navigation, footer clearance, and reading position during live updates. The general tool-invocation and delegated-outcome definitions were also clarified to match the observed runtime semantics; see [Copilot integration](copilot-integration.md).
