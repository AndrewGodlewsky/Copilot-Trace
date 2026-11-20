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
| `permission.completed` | `requestId`, optional `toolCallId`, typed `result`, optional `decisionSource` | Exact source and request ID, with a direct call ID or one unambiguous retained request's call ID. A direct call ID can link a decision when its request is absent. |
| `tool.execution_complete` | `toolCallId`, `success`, optional result/error data | Exact source and call ID; the success boolean is described as a reported result. |

IDs must be nonempty strings of at most 256 characters. Source is the event envelope's agent identity within the attached session; absent envelope identity denotes the main chat, while malformed identity is unknown. Display names, timestamps, chronological `parentId`, nearby events and natural-language promises never supply correlation. Evidence must be complete, within the existing 12,000-character limit, and match its projected event ID, type, source and timestamp. Raw tool IDs must also match the projected boundary IDs. No new raw projection or storage is introduced.

The request's optional `ownerAgentId` and `ownerSessionId` describe permission recovery ownership, including multiplexed remote sessions. They are not interchangeable with the event envelope source. Trace currently lacks a trusted mapping for that ownership, so a bucket containing either field remains separate rather than linking its request or decision to a tool. Original rows remain readable. Duplicate requests/decisions for one source and request ID, disagreeing call IDs, unusable fields and conflicting tool boundaries also remain ambiguous. Event IDs must be unique across retained records before supplying a stage link; data is parsed per record so a duplicate ID cannot substitute another source's decision. Repeated request/call IDs belonging to different known sources remain independent when their event IDs are unique.

## Outcomes and incomplete evidence

Recognized approval kinds are `approved`, `approved-read-only-for-session`, `approved-for-session` and `approved-for-location`. Recognized denial kinds are `denied-by-rules`, `denied-no-approval-rule-and-could-not-request-from-user`, `denied-interactively-by-user`, `denied-by-content-exclusion-policy` and `denied-by-permission-request-hook`. `cancelled` is distinct from denial. Missing or unrecognized kinds remain unknown.

The separate source enum is `assisted_approval`, `human_response`, `host_policy`, `unattended_fallback` or `authorization_carry_forward`. A kind containing “user” does not identify a human decision when the source is absent. The disposable fixture's programmatic rejection produces `denied-interactively-by-user` without `decisionSource`; Trace labels its decision source unknown. `resolvedByHook` and assisted-approval assessments are not final decisions.

No retained permission decision means **Permission unknown**, including tools that may have been preauthorized. Several permission requests or decisions remain individual records, with no overall authorization inferred. A decision for another request cannot resolve a missing decision. Unavailable history, omitted older events, shortened evidence and missing stage links remain disclosed. No generic “operation executed” stage is synthesized; tool-specific effects and independent verification remain outside this feature.

## Recorded grant scope

The permission event's explanation and the existing action-stage disclosure describe scope only when the complete result matches an inspected approval variant. The recorded decision kind remains separate: an `approved-for-session` record with a missing or malformed approval still reports that literal decision kind, but its grant scope is unknown. An original event can describe its own valid scope even when unsupported ownership prevents a tool link.

| Result kind | Required scope evidence | Description |
| --- | --- | --- |
| `approved` | No rule payload | Approval for this request without an added approval rule; existing authority is not described. |
| `approved-read-only-for-session` | Nonempty `directories` string array | Read-only directory grant for this session. |
| `approved-for-session` | Valid `approval` below | Reusable session grant for the recorded category. |
| `approved-for-location` | Valid `approval` and nonempty `locationKey` | Reusable project-location grant for the recorded category. |

All ten `UserToolSessionApproval` variants in the installed SDK are supported:

| Approval kind | Validated payload and described category |
| --- | --- |
| `commands` | Nonempty `commandIdentifiers` string array; command identifiers. |
| `read` / `write` | Kind only; read-only filesystem operations / filesystem write operations. |
| `mcp` | `serverName` and `toolName`; one server tool when the tool name is a string, all tools on one server when it is `null`. |
| `memory` | Kind only; long-term memory writes. |
| `custom-tool` | `toolName`; one custom tool. |
| `extension-management` | Optional `operation`; one operation when present, extension-management operations otherwise. |
| `workflow` | Optional `approvalKey`; one workflow approval key when present, workflow operations otherwise. |
| `extension-permission-access` | `extensionName`; one extension's permission-gated access. |
| `extension-env-access` | `extensionName` and nonempty `environmentVariables` string array; named environment variables for one extension. |

Strings must be nonempty after a whitespace check and at most 12,000 UTF-16 code units; collections contain at most 300 entries. Complete raw evidence must also fit the existing 12,000-unit record limit. Trace does not trim or rewrite the retained values. Empty command lists are conservatively unknown even though the SDK's `commandIdentifiers` declaration permits an empty array. Unknown properties, unknown variants and malformed required or optional fields make scope unknown. The optional `managedApprovalHandled` field must be boolean and is accepted only on the three SDK variants that declare it. These validation rules prevent a future narrowing field from silently becoming a broader grant description.

Scope text uses authored category descriptions. It adds no command, path, server, tool, extension, environment-variable or location previews; literal values remain in the existing bounded evidence. A reusable grant record does not establish current authority, successful storage, later reuse, a human response or a completed operation. Trace does not grant permissions or change policy. Historical `permission.carriedForward` and `permission.messageAuthorization` types are retired decode-only records in this SDK; they are not added as evidence of current authority.

## Runtime evidence and presentation limits

The disposable installed-runtime fixture uses fixed loopback model responses, one allowlisted built-in PowerShell tool, and a write to an owned temporary file. The approved case writes the fixed fixture text; the denied case produces a failed result and no file. Both record invocation entry before permission evaluation. This is a supported end-to-end operation path, without paid inference or existing user chats.

The attached Trace observer receives four linked live stages: assistant request, invocation entry, permission decision and tool result. In this installed build, the owner receives `permission.requested`, but that live event does not reach the joined observer. Trace therefore explicitly shows the request as unknown rather than constructing one. Reopening Trace hydrates that request from history with `ownerSessionId`; the unsupported recovery-ownership mapping then leaves both permission rows separate and the card's permission unknown. The raw request and decision remain available in the timeline. This difference is a tested host-routing variant, not evidence that permission was skipped.

The eighth disposable fixture session returns `approve-for-session` with a `commands` rule for `node` for one exact owned test command. Joined Trace retains the actual `approved-for-session` result and rule with no `decisionSource`; both the event helper and action stage describe a recorded session grant with unknown decision source. The permitted tool reports `success: true` while its typed process exit is `1`. The existing [validation overview](validation-overview.md) keeps that failed command distinct from permission and tool protocol status. The fixture proves the recorded grant shape on this runtime, not rule reuse or persistence in a user's profile. It uses two fixed responses within the existing total of twenty-two responses across eight owned sessions.

A synthetic full five-stage fixture covers the schema-supported request path without recovery-owner metadata. Unit cases also cover denial, cancellation, unknown kinds/sources, missing decisions, multiple requests, async/reversed delivery, duplicated and conflicting IDs, repeated IDs across agents, shortened data and retention. Renderer tests exercise the same disclosure and source buttons across grouped, chronological, request-chapter and agent-lane views, including Tools/Problems filters, focus, canonical history merges and unchanged Statistics. The disclosure moves with a retained visible tool boundary in ungrouped views; assistant and permission rows are never moved into a tool card or cloned.

Scope cases cover every inspected approval variant, invalid and oversized payloads, all recorded decision sources, cancelled work followed by a late decision, globally duplicated event IDs, and approved operations with failed tool or process results. Renderer cases keep the scope inside existing disclosures, preserve focus during updates, remove obsolete scope text and make evicted evidence links inert.

Automated DOM checks do not establish native layout or screen-reader behavior. The owner deferred those checks for this run. Pending acceptance includes narrow/short panes, enlarged text, nested keyboard navigation, stage readability, live reading position and native evidence-link focus.
