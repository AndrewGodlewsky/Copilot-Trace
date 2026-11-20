# Recorded hook pipelines

Trace explains retained hook pipeline invocations and links them to their original start/end evidence. A pipeline record can exist without a configured handler, and one invocation can include several callbacks. Statistics therefore counts pipeline identities, not scripts or callback executions.

The grouped view expands into invocation summaries followed by the original boundaries in recorded order. A summary can link boundaries in different groups without moving either event. In chronological, chapter and agent views, the same disclosure appears within a boundary's details. Evidence buttons show the exact retained event in chronological order and reset the filter. Filters preserve retained invocation context and Statistics totals.

An invocation is identified by the exact source and `hookInvocationId`: string sources of at most 256 UTF-16 code units, with the empty source representing the main chat, and nonempty string invocation IDs of at most 256 code units. Unknown sources and malformed IDs remain unlinked. Repeated names and IDs from different agents do not merge. Counts cover the retained window, including partial or conflicting invocations. Group and chapter counts are not additive when an invocation spans them.

## Lifecycle timing is authored guidance

The installed SDK documents these lifecycle points. The exact hook type remains visible; future types receive an unknown-timing explanation. Timing never establishes why the assistant selected a related operation.

| Hook type | Documented timing |
| --- | --- |
| `preToolUse` | Before tool execution; a pipeline can batch several tool requests. |
| `preMcpToolCall` | Before an MCP tool call. |
| `postToolUse` | After a successful tool result. |
| `postToolUseFailure` | After a `failure` result; excludes `rejected`, `denied` and `timeout`. |
| `userPromptSubmitted` | When the user submits a prompt. |
| `userPromptTransformed` | After runtime transformation, before storage or model delivery. |
| `sessionStart` / `sessionEnd` | When the session starts or ends. |
| `errorOccurred` | When an error occurs. |
| `agentStop` | At a natural main-agent terminal stop, excluding aborts and rejected-tool stops. |
| `subagentStart` / `subagentStop` | Before the first child turn / after a child turn. |

## Outcomes require matching evidence

Starts without ends never imply “still running.” Ends without starts remain partial. Duplicate boundaries, conflicting types and ends ordered before starts leave the invocation outcome unknown. Original evidence remains available even when a summary cannot interpret it.

Reported outcome, output and error require complete retained JSON within the existing 12,000-character evidence limit, matching event ID, type, source, timestamp, invocation ID and projected hook type. Success also must match the projected boolean. Original Unicode and markup render as literal text. Shortened or mismatched evidence supplies no interpreted output. Valid output remains inspectable as JSON, including for unknown future types.

Typed output can identify supplied `additionalContext` for the documented context-producing hook types, a `preToolUse.permissionDecision` request (`allow`, `deny`, `ask`), prompt/stop decision requests, or an `errorOccurred.errorHandling` request (`retry`, `skip`, `abort`). Subagent `block` requires a nonempty reason; `allow` requires no reason. Generic prose, inputs and pipeline success cannot become decisions or context. These fields report requests and supplied content; Trace does not infer actual approval, blocking, injection effects, compliance or task success. Other output stays literal without interpreting its effects.

Trace reads no configuration or scripts and makes no model requests for these summaries. Retained hook copies of tool or skill content may omit duplicated text; canonical tool results remain in their tool events.

## Evidence and remaining checks

The installed-runtime fixture uses SDK/runtime `1.0.106-8.unstable.r43566476370.g869eef3`, disposable sessions, two owned local MCP tools and fixed local responses. Five registered callback executions produce nine pipeline invocations and eighteen boundaries, including types without registered handlers. One `preToolUse` start batches two tool requests; its end exposes no output despite callback-supplied context. Both `postToolUse` ends expose their supplied context. The fixture checks exact Trace projections and invocation descriptors.

Unit and renderer tests cover identities, interleaving, partial/conflicting pairs, typed output, unknown types, malformed/oversized evidence, literal content, filters, views, navigation, focus and retention. Native narrow/short-pane layout, enlarged text, keyboard/screen-reader behavior and live desktop reading position require owner checks. Automated DOM tests do not establish those results.

Sources: installed `types.d.ts` (`SessionHooks` and hook input/output contracts), `generated/session-events.d.ts` (`HookStartData`, `HookEndData`), and the repository's [installed-runtime integration fixture](../scripts/e2e.mjs). See [Copilot integration](copilot-integration.md) for host boundaries.
