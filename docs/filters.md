# Activity filters

The Filter selector offers four mutually exclusive choices in every view. It affects only this open panel's presentation. It does not delete records, change subscriptions, change retained Statistics, save a preference, or make model calls. Reset filters selects Everything.

| Filter | Matching recorded events |
| --- | --- |
| Everything | Every retained event. |
| Tools | Exact `tool.execution_start` and `tool.execution_complete` types. A tool call is not proof of a file change. |
| Skills and hooks | Exact `skill.invoked`, `hook.start` and `hook.end` types. |
| Problems | Exact `session.error`, `session.warning`, `abort` and `subagent.failed` types; also `tool.execution_complete` and `hook.end` only when their projected `success` is the boolean `false`. |

The predicates use the latest snapshot records, including canonical history replacements with existing event IDs. Text mentioning an error, unknown event types, missing completions, and permission waiting or decisions do not establish a problem for this filter. A warning or interruption is included as recorded evidence to inspect; inclusion does not establish task failure. Unknown filter preferences fall back to Everything.

The status reports matching, filter-hidden and retained **event** counts. A matching record remains counted when its disclosure is collapsed; these are not viewport counts or tool-call totals. A zero-match message offers reset and differs from waiting for activity or an unavailable event API. Older events omitted by retention remain separately reported; Reset cannot restore omitted history. Statistics always covers the full retained snapshot.

Turn contexts, tool calls, adjacent hook groups and request chapters are derived from the full retained sequence before filtering. Hidden inputs and turn markers still delimit intervals; hidden intervening records never make two hook groups adjacent. Each matching event retains its original source metadata and any supported same-source turn context. Unknown or unavailable context stays unknown. Request chapters remain the original chronological intervals even when their input rows are hidden.

Only matching event rows are shown. A grouped call, hook group or chapter remains if it has a match; its header is labeled **Retained … context** with matching and hidden event counts. Header descriptions, input previews, outcomes and chapter statistics continue to use all records in that retained group, including hidden records. These headers are context, not additional matching events. Tool boundary buttons may target a hidden start or result. Every boundary or reported-activity evidence navigation deliberately selects Everything and Chronological events, then opens and focuses the exact retained source event. The help text explains this reset.

While any focused filter is active, all timeline connector arrows are suppressed, including inside groups and chapters, and the status explains that hidden events can leave gaps. This deliberately favors a simple gap notice over adding inferred interval or causality markers. Grouped calls retain their usual first-boundary position; chronological mode still provides exact retained event order.

Matching rows, their evidence elements, group/chapter disclosures and the selected filter survive polling and view changes. Hidden rows remain cached while retained, preserving open state when shown again. A focused control that becomes hidden, or whose record is evicted under an active filter, moves to the visible Filter selector without scrolling. Retained visible focus is preserved. Filter, reset and evidence-navigation interactions pause Follow live; only an explicit evidence-navigation action scrolls to its target.

Automated coverage uses exact predicate fixtures and the actual renderer with a small DOM boundary double. It covers all three views, incoming matching/nonmatching data, same-ID replacement, retention, full-snapshot boundaries, focus, reset and evidence navigation. Native narrow/short-pane reachability, enlarged text, keyboard/screen-reader behavior and live manual reading remain owner-performed checks; the DOM double does not prove layout or native focus behavior.
