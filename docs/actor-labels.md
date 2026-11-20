# Actor labels

Trace labels the recorded role of each event separately from its agent source. The mapping uses exact event types, independently of card color, icon, category and nearby events. It is authored presentation logic, not model interpretation. The implementation is in [presentation.mjs](../com.github.copilot/extensions/trace/web/presentation.mjs).

| Actor label | Exact event types | Meaning and limits |
| --- | --- | --- |
| User | `user.message` | Input recorded in the user role. This can include system, command, skill or inter-agent input supplied by the host; the label does not establish that a person typed it. |
| Assistant | `assistant.turn_start`, `assistant.turn_end`, `assistant.intent`, `assistant.message`, `assistant.reasoning` | Assistant output and model-turn boundaries. A turn marker is a lifecycle record. Reported activity or reasoning is not a complete or independently verified account of decisions. |
| Tool | `tool.execution_start`, `tool.execution_complete` | Runtime execution of a tool. A tool running for a subagent remains a Tool. |
| Configured automation | `hook.start`, `hook.end` | A configured workflow hook and its recorded outcome. The label does not attribute a model decision. |
| Permission system | `permission.requested`, `permission.completed` | Permission requests and recorded decisions. Who decided is only known when the evidence records it; the label does not imply human approval. |
| Instruction loading | `skill.invoked` | A recorded skill invocation or load. The existing step description reports the trigger when recognized. |
| Host | `subagent.started`, `subagent.completed`, `subagent.failed`, `session.compaction_start`, `session.compaction_complete`, `session.error`, `session.info`, `session.warning`, `abort` | Session and delegated-work lifecycle events. A subagent lifecycle notification is distinct from that subagent's assistant output or tools. |
| Actor unknown | Every other event type | No supported mapping exists. A familiar prefix or category cannot supply a role. The current collector omits unsupported events; this is the presentation fallback if one reaches the viewer. |

The expanded metadata keeps **Actor**, **Source** and the exact **Event** type separate. Source describes the event's recorded agent context, not the initiator of an action or the target of a delegation:

| Projected `agentId` | Source label |
| --- | --- |
| Empty string | Main chat |
| Nonempty string of at most 256 UTF-16 code units | Agent followed by the exact ID |
| Missing, `null`, non-string or longer than 256 code units | Source unavailable |

The collector projects an omitted raw agent ID to an empty string for the main chat. Invalid raw IDs become `null`; they do not become the main chat. The viewer preserves valid IDs literally, including Unicode, and inserts them as text.

Cards show actor text alongside the existing icons and colors. Consecutive hooks show Configured automation once on their group heading; nested steps retain Actor and Source in expanded metadata. Turn closing markers keep their compact layout and expose Actor in metadata. The keyboard-accessible **Actor labels and sources** disclosure explains all labels. Opening it pauses Follow live while the reader inspects the help.

Grouping and arrows show recorded order and timing. Neither the actor label nor the source establishes why a neighboring event happened.
