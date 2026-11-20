# Requested operation categories

Tool cards show a compact text badge such as **Requested: Read**, **Requested: Execute** or **Requested: Unclassified**. The same badge accompanies each retained boundary in Chronological events, Request chapters and Agent lanes. **Observed action stages and category limits** explains the interpretation and links to the original invocation and result evidence. Filters change visibility, not the retained basis or Statistics.

Categories describe the operation requested by recorded arguments. They do not assert permission, execution, success or completed side effects. Failed and denied calls retain a valid requested category; their recorded result and permission decision stay separate. An unknown category is not a statement that a tool does nothing or is safe.

## Supported contract map

The map in `web/presentation.mjs` is an authored interpretation of the materialized contracts inspected in installed runtime `1.0.106-8.unstable.r43566476370.g869eef3`. Those descriptors are neither the offered inventory nor proof of the implementation behind an invocation. A custom tool can override a familiar name. [Tool provenance](tool-provenance.md) remains separate and usually unknown for names without supported MCP metadata.

| Exact recorded name or evidence | Required structured arguments | Requested categories |
| --- | --- | --- |
| `view` | Nonempty string `path` | Read |
| `grep` | Nonempty string `pattern` | Search |
| `glob` | Nonempty string `pattern` | Search |
| `create` | Nonempty string `path`, string `file_text` (including empty) | Edit |
| `edit` | Nonempty string `path` | Edit |
| `powershell` | Nonempty string `command`, nonempty string `description` of at most 100 code units | Execute |
| `web_fetch` | HTTP(S) `url` string | Read, External access |
| Supported invocation-specific MCP metadata | Complete object `arguments`; validated MCP tool and server identities | External access |

`view` covers a requested file, image or directory view. `grep` and `glob` describe content or filename searches without claiming matches were found. Edit includes attempted file creation and replacement. The inspected `edit` schema requires only `path`; `old_str` and `new_str` are optional strings. Empty replacement text is accepted and does not cause Trace to infer deletion, a particular diff or a successful write. Trace never opens a path to validate it, establishes that it exists, or resolves a relative path. Path syntax and runtime acceptance remain outside this structural interpretation.

Recognized optional arguments are validated before a category or action title is supplied:

| Name | Supported optional fields |
| --- | --- |
| `view` | Boolean `forceReadLargeFiles`; `view_range` with two safe integers, start at least 1 and end at least start or `-1` for EOF. |
| `grep` | `paths` as a nonempty string or nonempty array of nonempty strings; string `glob` and `type`; `output_mode` of `content`, `files_with_matches` or `count`; booleans `-i`, `-n`, `multiline`; nonnegative safe integers `-A`, `-B`, `-C`, `head_limit`. |
| `glob` | The same `paths` forms. |
| `edit` | String `old_str` and `new_str`, preserving empty strings and whitespace. |
| `powershell` | Nonempty string `shellId`; `mode` of `sync` or `async`; boolean `detach` only with explicit `async`; numeric `initial_wait` from 30 to 600. |
| `web_fetch` | Positive safe integer `max_length` up to 20,000; nonnegative safe integer `start_index`; boolean `raw`. |

Unknown fields, malformed types and unsupported values make the request Unclassified. This intentionally supports a conservative subset of the contracts, not full runtime validation or a prediction that a request will be accepted. Unknown names and aliases do not inherit another tool's mapping. `apply_patch` uses a freeform grammar and remains Unclassified; Trace does not interpret its patch text.

Shell command text stays opaque. A command containing reads, writes, network calls, pipes, aliases or several commands receives only Execute when its structured request matches. The description is also literal input, not a trusted description of effects. Neither string can add Read or imply read-only behavior.

For MCP, External access means a requested interaction with a service outside the assistant. The service can be local, in-process or remote. It does not prove a network request or establish the service-specific operation. Supported MCP metadata takes precedence over the model-facing name: an MCP tool aliased as `view` cannot gain Read or a `View <path>` title. Partial or malformed MCP metadata stays Unclassified and cannot fall through to a familiar-name contract. All categories leave actual implementation and possible effects unknown and provide no security guarantee.

## Evidence, correlation and retention

`toolOperations(entries)` returns descriptors keyed by original event ID. Categories and [action titles](action-titles.md) share `requestedOperation`, while categories and provenance share `toolBuckets` identity checks. The renderer passes the same descriptor to each title and badge, including when conflicting retained boundaries invalidate a formerly recognized call.

Classification requires complete retained JSON within the existing 12,000 UTF-16-code-unit evidence bound. The raw event ID, type, timestamp and source must match the projected entry. The exact raw and projected tool-call IDs and start tool name must agree. An optional result tool name cannot contradict the start. Correlation uses only the exact source-agent and call IDs in the current attached session, never a display name, alias, argument text or neighboring event.

A call needs one unique start and at most one unique result. Result-only calls, duplicated starts/results, unknown sources, mismatched identities and malformed or truncated boundary evidence remain Unclassified. A unique failed result may share its valid start's descriptor. When the start leaves the retained window, its result loses the category; nothing is cached across snapshots, sessions or agents.

The panel changes no arguments, results or recorded evidence. Names and titles use text rendering, preserving literal markup and Unicode. Titles retain their 180-code-unit surrogate-safe bound. Parsing causes no command execution, file access, URL navigation, metadata discovery RPC or inference.

## Extending and verifying the map

Establish an exact contract and its evidence source before extending `operationContracts`. Add a row to `test/operation-categories.test.mjs` with literal structured arguments and expected categories, then cover missing fields, malformed optional fields, unknown aliases, misleading argument text and the raw-title fallback. Add multiple categories only when the documented request supports each one. Freeform command or patch grammars need a separately justified parser and fixtures; do not infer semantics from a name prefix.

The same file covers failed and denied calls, MCP aliases and transports, source/call collisions, raw/projected identity mismatches, complete bounded evidence and literal Unicode. `test/app.test.mjs` covers all four views, filters, unchanged totals/evidence, source navigation, retained focus and reading position, newly ambiguous calls and start eviction. These tests use disposable local events and the existing DOM boundary double, not paid inference or private sessions.

Owner-performed UI acceptance is explicitly deferred for the November 20, 2026 overnight run. Pending checks are badge meaning without color; category-limit readability; narrow/short panes and enlarged text; keyboard and screen-reader access; original-evidence navigation; and live focus, reading position and retention in the native host. Automated tests do not establish native layout or accessibility acceptance. Independent review, automated verification, packaging and publication remain required; the issue stays open until manual checks are recorded.
