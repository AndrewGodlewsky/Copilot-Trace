# Failures and related-attempt suggestions

Open **Failure and related-attempt suggestions** inside a retained failed tool result, or a linked permission denial/cancellation. The optional disclosure keeps the original operation first and shows up to three later matching requests in recorded order. Each operation has its own arguments, result/error values, permission summary and original-evidence buttons. Arguments and result/error objects are rendered as JSON text, preserving string values and Unicode; no command is executed.

These are suggestions for inspection, not recorded retries or proof of recovery. The original failure remains a failure when a later tool reports success. Neither report establishes a process exit status, passing tests, correct effects or completion of the user's task. A permission denial or cancellation is displayed separately from the tool outcome. A nearby session abort does not cancel every outstanding invocation, and an open error-code string such as `cancelled` is not treated as a typed cancellation.

## Supported matching rule

Matching uses only retained evidence and requires a unique, valid source/call identity, one complete matching start, at most one result, and no reversed or duplicate boundaries. The candidate's start must occur after the original result or linked adverse permission decision. Interleaved calls that began before the failure are excluded. Display names, neighboring positions, prose and chronological envelope `parentId` never establish a match.

Every candidate must have the same exact source identity and recorded tool name. The source is the main chat or a particular agent ID; agents sharing a display name remain separate. The disclosure states the exact rule applied:

| Recorded request | Required equality | Options that may differ |
| --- | --- | --- |
| `view`, `create`, `edit` | Literal `path` | Other supported fields, including ranges or edit text |
| `grep` | Literal `pattern`, `paths`, `glob`, `type`, including absent fields | Other supported output/context options |
| `glob` | Literal `pattern`, `paths`, including absent fields | None in the supported contract |
| `web_fetch` | Literal `url` | Supported range/size/raw options |
| `powershell` | Entire literal `command` and `shellId`, including absence | Supported description, mode and wait options |
| MCP invocation | Configured server key, server tool name, recorded model tool name, all other supported MCP provider metadata, and serialized arguments | No argument differences are matched without a tool-specific contract |

The ordinary tool rules reuse the existing [operation-category contracts](operation-categories.md). All argument fields must satisfy those contracts; unknown fields or malformed values are excluded. Both requests must have no MCP/provider markers. Their provider/origin remains **unknown**: equal recorded tool names and argument targets do not establish the same implementation. A same-path edit may be unrelated work, and an identical shell command may have a different purpose or environment. Trace does not normalize paths or URLs, parse shell commands, compare semantic meaning, or claim identical working-directory context when it is unrecorded.

MCP matching requires `mcpConfigServerName` and `mcpToolName` with valid metadata. Display-only or legacy `mcpServerName` evidence without the configured key is insufficient. Even a matching configured identity does not establish the same service state or a causal retry. MCP argument matching is deliberately conservative: JSON field order must also match. Changed MCP arguments remain accessible in their original timeline rows, without a suggestion.

## Outcomes, evidence and bounds

Tool success/failure is read only from complete matching result evidence and its matching projected boolean. Permission summaries reuse [action stages](action-stages.md), including their exact source/call/request ownership restrictions. Unsupported ownership, repeated IDs or conflicting boundaries do not acquire inferred links. A typed denied/cancelled permission can be inspected with a missing tool result; the operation's result remains unknown.

Missing starts do not acquire reconstructed arguments or matching targets. Missing, malformed or clipped results remain unknown, even if the candidate's intact start is comparable. A complete result-only failure can still show its result and explain the missing start. An unusable original failure cannot create a new failure disclosure, but its original timeline evidence remains available. Results/errors absent from an otherwise valid record are labeled unavailable.

The window retains at most 300 events. Earlier omitted events, unavailable/loading history, missing attempts and incomplete results are explicitly disclosed. The feature does not claim a complete sequence outside that window. Each original has at most three candidate controls; further matches receive an omitted count and remain in their original rows. Each operation links its retained start/result and at most three unique permission decisions, with additional decisions counted and left in the timeline. This bounds repeated controls even when a call has many permission decisions.

Original-evidence buttons capture a frozen record and validate its ID, type, source, timestamp, raw evidence, clipping and output-extent metadata before navigation. They cannot redirect to changed same-ID records. Navigation opens the original evidence in chronological order, clears a hiding filter and pauses Follow. Opening an inspection also pauses Follow. Disclosures and unchanged text controls survive polling and view changes; removed evidence receives the panel's existing visible focus fallback. No data is persisted, no private child session is queried, and the host integration/projection is unchanged.

## Installed SDK limitation

Inspected installed SDK build `1.0.106-8.unstable.r43566476370.g869eef3`, `generated/session-events.d.ts`: `ToolExecutionStartData` and `ToolExecutionCompleteData` do not expose a generic retry-of invocation field. Therefore explicit causal tool-recovery links are unsupported in this version; the feature implements the issue's allowed, disclosed similarity suggestions.

The other inspected fields cannot supply that missing relationship:

- `ModelCallFailureData.retryAttempt` is an orchestrator model-retry index.
- Workflow `retryGuidance` is resume guidance.
- Permission sandbox retry metadata describes escalation conditions.
- Tool-result `causalDependencies` names accepted assistant messages consumed across agents, not previous tool invocations or recovery relationships.
- Envelope `parentId` is chronological linkage. `parentToolCallId` describes subagent invocation context, not retry ownership.

See [Copilot integration](copilot-integration.md) for the source and ownership boundaries. No new runtime fixture is required for this presentation-only change; these declarations do not prove universal runtime behavior or native rendering.

## Validation and pending manual acceptance

Disposable unit and DOM fixtures cover changed arguments, unrelated shell commands/targets, same-name sources/providers, permissions, abort, later success, overlapping starts, malformed/clipped/duplicate/reused IDs, result-only evidence, missing results, retained eviction, literal text, capped suggestions, stable disclosures/reading/Follow, filters/view changes and stale original links.

Owner-performed native checks remain pending under the authorized UI deferral for this run: distinguish suggestions from proven relationships, inspect long arguments/results, narrow and short panes, 150% text, keyboard/focus, live updates and eviction. DOM fixtures do not establish rendered geometry or assistive-technology behavior.
