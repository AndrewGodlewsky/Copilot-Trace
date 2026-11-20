# Jump to retained events

The **Jump to latest** selector and **Jump** button sit beside the timeline's view and filter controls. They search the full current retained snapshot, including events hidden by filters or collapsed groups. No additional history is collected or stored.

| Category | Exact recorded predicate |
| --- | --- |
| Failure | `session.error` or `subagent.failed`, or `tool.execution_complete` / `hook.end` with the boolean `success === false`. |
| Permission request | `permission.requested`. A request is not evidence that permission is still pending or was granted. |
| Skill load | `skill.invoked`. This records invocation/loading, not proof that instructions were followed. |
| Tool result | `tool.execution_complete`, including results whose success is unknown. |

These categories use event types and the projected success boolean, never titles, explanations or failure-looking text. Warnings, interruptions, permission decisions and missing results do not establish a failure. A tool or hook failure is its reported operation outcome, not proof that the user's task failed. Unlike the broader Problems filter, Failure excludes warnings and interruptions.

“Latest” means the last matching event in **retained collector order**, not the latest event in the entire chat or a guaranteed wall-clock ordering. The collector orders parseable recorded timestamps, keeps history/arrival order for ties, and puts missing or unparseable timestamps last. Navigation preserves that order without sorting again. An event with unknown time can therefore be the selected target. Earlier or unsupported events may be unavailable, and history arriving later may change the target. Only nonempty string event IDs of at most 256 characters are usable navigation targets.

A jump rechecks the current snapshot, pauses Follow live, selects Everything and Chronological events, opens the exact original event and centers its summary with keyboard focus. This works from Grouped tool calls, Chronological events, Request chapters and Agent lanes, including hook results and events inside model-turn intervals. Retained evidence nodes and other disclosure states are reused. The target's own disclosure opens deliberately. Source-evidence buttons share the same guarded reveal path.

When no matching event is retained, Jump is disabled and a neutral status explains the empty state. A queued activation still rechecks availability. An evicted or unusable source target is rejected before changing the view, filter, follow setting, focus or scroll position. Navigation messages contain only fixed category/status text, never event IDs or evidence. New events do not trigger another jump; activating Jump again selects the current latest match. Rechecking Follow live uses the existing controller to return to the document bottom and resume following.

Automated coverage uses disposable event fixtures and the actual renderer with a small DOM boundary double. It checks all four predicates and views, hidden and collapsed targets, original evidence identity, no matches, unusable IDs, stale source links, retention changes, repeated activation, live updates and the actual Follow controller. These tests do not establish native rendering or screen-reader behavior. Owner checks remain pending for narrow/short panes, enlarged text, keyboard-visible focus, native status announcements, summary clearance from the sticky toolbar and footer dock, and live reading-position stability.
