# Recorded action stages

Tool cards expose **Observed action stages and category limits**: the assistant's structured tool request, a runtime invocation entry, any linked permission request and decision, and a reported tool result. The same disclosure explains the [requested operation category](operation-categories.md) and its limits. Only retained records appear. The list keeps their recorded order and timestamps; it is not a required sequence or a progress checklist. Each button opens the exact original event and its literal evidence in Chronological events, resets the filter and pauses Follow live.

An invocation entry does not prove that the underlying operation ran. The inspected runtime emits `tool.execution_start` before permission evaluation, including when permission is denied and the requested file write never occurs. Approval permits an operation; a result reports the tool's outcome. Neither establishes that the user's overall task is correct or complete. A missing result does not mean the tool is still running.

## Inspected fields and matching

The inventory below comes from the installed SDK build `1.0.106-8.unstable.r43566476370.g869eef3`, specifically `generated/session-events.d.ts`. Trace observes the host-owned attached session; it does not add permission handlers, execute tools or issue decisions.

| Record | Supported evidence | Correlation |
| --- | --- | --- |
| `assistant.message` | `toolRequests[].toolCallId`, `name`, `arguments` | Exact source and call ID; one unambiguous request. A retained start's tool name must agree. Assistant prose is never an action record. |
| `tool.execution_start` | `toolCallId`, `toolName`, optional `arguments` | Exact source and call ID. Described as invocation entry, including before permission. |
| `permission.requested` | `requestId`, `permissionRequest.toolCallId` when present | Exact source and request ID; call ID must agree with any decision. A uniquely matched decision can supply its optional call ID. |
| `permission.completed` | `requestId`, optional `toolCallId`, `result.kind`, optional `decisionSource` | Exact source and request ID, with a direct call ID or one unambiguous retained request's call ID. A direct call ID can link a decision when its request is absent. |
| `tool.execution_complete` | `toolCallId`, `success`, optional result/error data | Exact source and call ID; the success boolean is described as a reported result. |

IDs must be nonempty strings of at most 256 characters. Source is the event envelope's agent identity within the attached session; absent envelope identity denotes the main chat, while malformed identity is unknown. Display names, timestamps, chronological `parentId`, nearby events and natural-language promises never supply correlation. Evidence must be complete, within the existing 12,000-character limit, and match its projected event ID, type, source and timestamp. Raw tool IDs must also match the projected boundary IDs. No new raw projection or storage is introduced.

The request's optional `ownerAgentId` and `ownerSessionId` describe permission recovery ownership, including multiplexed remote sessions. They are not interchangeable with the event envelope source. Trace currently lacks a trusted mapping for that ownership, so a bucket containing either field remains separate rather than linking its request or decision to a tool. Original rows remain readable. Duplicate requests/decisions for one source and request ID, disagreeing call IDs, unusable fields and conflicting tool boundaries also remain ambiguous. Repeated IDs belonging to different known sources are independent.

## Outcomes and incomplete evidence

Recognized approval kinds are `approved`, `approved-read-only-for-session`, `approved-for-session` and `approved-for-location`. Recognized denial kinds are `denied-by-rules`, `denied-no-approval-rule-and-could-not-request-from-user`, `denied-interactively-by-user`, `denied-by-content-exclusion-policy` and `denied-by-permission-request-hook`. `cancelled` is distinct from denial. Missing or unrecognized kinds remain unknown.

The separate source enum is `assisted_approval`, `human_response`, `host_policy`, `unattended_fallback` or `authorization_carry_forward`. A kind containing “user” does not identify a human decision when the source is absent. The disposable fixture's programmatic rejection produces `denied-interactively-by-user` without `decisionSource`; Trace labels its decision source unknown. `resolvedByHook` and assisted-approval assessments are not final decisions.

No retained permission decision means **Permission unknown**, including tools that may have been preauthorized. Several permission requests or decisions remain individual records, with no overall authorization inferred. A decision for another request cannot resolve a missing decision. Unavailable history, omitted older events, shortened evidence and missing stage links remain disclosed. No generic “operation executed” stage is synthesized; tool-specific effects and independent verification remain outside this feature.

## Runtime evidence and presentation limits

The disposable installed-runtime fixture uses fixed loopback model responses, one allowlisted built-in PowerShell tool, and a write to an owned temporary file. The approved case writes the fixed fixture text; the denied case produces a failed result and no file. Both record invocation entry before permission evaluation. This is a supported end-to-end operation path, without paid inference or existing user chats.

The attached Trace observer receives four linked live stages: assistant request, invocation entry, permission decision and tool result. In this installed build, the owner receives `permission.requested`, but that live event does not reach the joined observer. Trace therefore explicitly shows the request as unknown rather than constructing one. Reopening Trace hydrates that request from history with `ownerSessionId`; the unsupported recovery-ownership mapping then leaves both permission rows separate and the card's permission unknown. The raw request and decision remain available in the timeline. This difference is a tested host-routing variant, not evidence that permission was skipped.

A synthetic full five-stage fixture covers the schema-supported request path without recovery-owner metadata. Unit cases also cover denial, cancellation, unknown kinds/sources, missing decisions, multiple requests, async/reversed delivery, duplicated and conflicting IDs, repeated IDs across agents, shortened data and retention. Renderer tests exercise the same disclosure and source buttons across grouped, chronological, request-chapter and agent-lane views, including Tools/Problems filters, focus, canonical history merges and unchanged Statistics. The disclosure moves with a retained visible tool boundary in ungrouped views; assistant and permission rows are never moved into a tool card or cloned.

Automated DOM checks do not establish native layout or screen-reader behavior. The owner deferred those checks for this run. Pending acceptance includes narrow/short panes, enlarged text, nested keyboard navigation, stage readability, live reading position and native evidence-link focus.
