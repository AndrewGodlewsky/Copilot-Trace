# Delegated tasks and returned results

Open **Delegated task and returned result** in the first retained event for a child agent. The disclosure shows the recorded parent prompt and description, child lifecycle, and text returned by the parent task tool. Original-evidence buttons connect these records in recorded order. Each child has one disclosure, including when two children share a display name. Existing views keep their own ordering; the disclosure does not move events into a delegation tree.

The child’s completion event and the parent’s returned text are separate evidence. A child may complete, fail or be cancelled before a parent result is retained. A missing result may arrive later or lie outside the retained window; it does not establish that work is still running. Reported tool success and returned text do not establish task correctness. Separate child context does not prove that a particular file, instruction or parent message was included or excluded.

## Supported evidence

The installed SDK build `1.0.106-8.unstable.r43566476370.g869eef3` declares the child instance in envelope `agentId` and the spawning invocation in lifecycle `data.toolCallId`. Child activity can also report `data.parentToolCallId`. The envelope’s `parentId` is the preceding event in chronology and supplies no delegation relationship.

The distinct `subagent.started.data.parentId` is the spawning subagent’s task-registry ID, absent for a root-spawned child. The disposable nested fixture establishes that this value matches the parent’s envelope `agentId` on the inspected build. The handoff helper requires that exact retained parent source; it does not substitute `ownerNativeSessionId`, display names or nearby events. With no retained start, a unique source/call candidate can provide a parent link, but task content stays unavailable without the required start metadata. Reused calls under different explicit parent sources remain separate. Duplicate boundaries, conflicting child calls or multiple children claiming the same parent invocation suppress the association.

Task text is supported for the observed synchronous `task` contract: object arguments with string `prompt` and `description`, `mode: "sync"`, and `agent_type` matching the started child’s internal `agentName`. Optional started `agentType` and `executionMode` must agree. MCP metadata, other tool names, malformed arguments and unrecognized modes do not qualify. The helper does not classify a tool as built-in from its name alone; the matched child lifecycle and arguments are also required.

The returned body comes from the exact parent `tool.execution_complete.data.result.content` string. `detailedContent`, child assistant messages and lifecycle metadata are not substitutes for that field. A failed parent task can still have literal result text; its reported success remains false. Empty strings, absent/nontext fields, clipped evidence and conflicting records have distinct explanations. Original child records remain inspectable when the parent is unknown.

## Bounds and interaction

Interpretation requires complete retained evidence matching the projected event ID, type, timestamp, source and call identity. The collector retains at most 300 events and 12,000 UTF-16 code units of evidence per event. Clipped JSON is not reconstructed, even when a desired field appears before the cut. The plugin reads no private child session, reported path or saved transcript and starts no task or model request.

Text uses literal, keyboard-focusable `<pre>` elements with bounded scrolling. One disclosure per child keeps activity links proportional to retained records. Original-evidence buttons freeze the source identity and exact evidence: an evicted or changed same-ID target cannot redirect an old button. Valid navigation selects Chronological events, restores Everything and pauses Follow live. Existing disclosures, focus and scroll positions survive refreshes and view changes; a disclosure can move to the child’s next retained record when its anchor is evicted. Removed or hidden controls use the existing focus fallback.

## Verification

Unit and DOM fixtures cover nested and overlapping same-name agents, unknown parents, missing and late results, failure and cancellation, invalid/reused/conflicting identities, partial history, long Unicode and markup text, clipping, literal rendering, source guards, focus, filters, live updates and retention. The existing parallel runtime phase checks both children’s exact handoff and returned result. A seventh disposable session exercises main task → middle task → tool-free leaf → middle return → main return with five fixed local responses. Its nested sources, call IDs, task arguments, lifecycle and result bodies match the attached Trace snapshot and helper output. The complete installed-runtime fixture uses twenty fixed responses across seven disposable sessions, with no paid inference or existing user chat.

Native clarity of the handoff/context explanation, long text, narrow and short panes, 150% text, keyboard/focus, original navigation and live retention behavior remain owner-deferred for tonight’s run. Automated checks do not claim those manual checks passed. See [Copilot integration](copilot-integration.md) and [development workflow](development-workflow.md) for runtime boundaries and acceptance requirements.
