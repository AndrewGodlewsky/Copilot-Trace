# Recorded action titles

Trace gives two recognized structured tool-start schemas a concise title:

| Exact recorded tool name | Required argument | Title |
| --- | --- | --- |
| `view` | Nonempty string `arguments.path` | `View <path>` |
| `grep` | Nonempty string `arguments.pattern` | `Search for pattern “<pattern>”` |

These titles describe recorded requests. A view target can be a file or directory; a search pattern can be a regular expression. Neither title claims that content was read, matches were found, an operation succeeded, or why the assistant chose it. Optional arguments remain in the original evidence; the title is not a complete summary of every option. Status stays separate.

Only complete retained JSON evidence from `tool.execution_start` is used. Its exact tool name must match the projected name, and `arguments` must be an object with the required string field. Unknown names or schemas, absent/malformed arguments, truncated evidence and shell commands keep the recorded tool name. Completion cards continue to show the correlated tool name and recorded result status; this change does not group start and completion cards.

Titles are bounded to 180 UTF-16 code units, including an ellipsis, without splitting a surrogate pair. The original tool name, source, arguments and event remain in expandable recorded evidence, subject to the existing 12,000-code-unit evidence limit. The title helper never alters that evidence. Text goes through the existing `textContent` rendering, including HTML-like strings and Unicode. It adds no HTML parsing, URL interpretation, file access or command execution.

To add a mapping, first establish the exact tool name and structured argument schema. Add fixtures for recognized, absent and malformed inputs, unknown names, long Unicode and HTML-like values, failure status and live/history reconciliation. Keep arbitrary shell strings opaque, use a neutral description where the schema does not establish intent or target type, and preserve the original evidence and fallback. Do not infer a provider, permission decision, side effect or causal relationship from a title.

Owner acceptance must cover narrow panes, enlarged text, expanded evidence, keyboard focus and Follow live during completion/history updates. Automated presentation tests do not establish native layout acceptance.
