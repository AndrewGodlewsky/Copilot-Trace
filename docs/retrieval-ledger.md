# Recorded information retrieval

**Statistics → Information retrieval ledger** lists recognized read, search and external retrieval requests from retained events. Each occurrence has its recorded arguments, reported outcome and buttons for the original request and result. Successful text responses have a separate disclosure. Failed response text stays in the original result as diagnostic evidence.

The ledger helps inspect the evidence returned by a tool. It cannot establish that the model understood, used or still has that information in active context. A request does not prove execution, and a success report does not prove complete file or document coverage.

## Supported requests

`retrievalLedger(entries, snapshot)` in `web/presentation.mjs` supplies the rows, statuses, reference count and uncertainty notes used by the panel. It reuses `toolBuckets`, `requestedOperation` and `explanationData`, rather than classifying result prose or consulting current tools. The existing [requested operation contracts](operation-categories.md#supported-contract-map) define required fields, allowed optional fields and types.

| Exact name | Recorded target | Scope shown |
| --- | --- | --- |
| `view` | Literal `path` | Optional `view_range` and `forceReadLargeFiles`. A view can target a file, image or directory; the ledger does not infer its type. |
| `grep` | Literal `paths` string or array, when present | Pattern, output mode, head limit, context lines, glob/type filters and other supported flags. Missing paths or output mode remain explicitly unrecorded. |
| `glob` | Literal `paths`, when present | Pattern and file-list semantics. |
| `web_fetch` | Literal HTTP(S) `url` | Optional start index, maximum length and raw flag. The ledger renders the URL as text and never visits it. |

Every supplied argument must match the existing contract; unknown fields, malformed values and aliases remain unclassified. Invocation-specific MCP metadata takes precedence over a friendly tool name, including a service tool called `view`. Explicit `origin` or `overridesBuiltInTool` fields are also treated conservatively as unsupported origin evidence, not as verified host discriminators. They cannot establish a retrieval contract. Recognized edit/execute requests are outside this ledger.

Matching a contract describes requested semantics. It does not prove a native implementation: custom overrides can share names and argument schemas without an observable origin discriminator. The ledger keeps actual implementation and origin unknown. No project file, current skill, inventory or external service is read to fill missing evidence.

## Results and partial scope

| Recorded evidence | Ledger behavior |
| --- | --- |
| One matched result reports `success: true`, with nonempty string `result.content` and no contradictory error | Reported success, text returned. The exact retained string is available. |
| The same successful result has `content: ""` | Reported success, empty response. This does not establish an empty target or no search matches. |
| Matched result reports `success: false` | Reported failure. Diagnostic text is never exposed as retrieved content. |
| A recognized request has no retained result | Completion not observed; it is not assumed still running. |
| Success is unknown or contradicts the projected flag, an error accompanies success, or text is absent/nontext | Returned text unavailable. A valid success flag is still reported separately when only text is missing. |
| A required boundary is clipped, malformed, identity-mismatched, missing or conflicting | Navigable unclassified call, with no reconstructed arguments, successful content or reference claim. |

The installed SDK describes `result.content` as concise model-facing text that may already be shortened, and `detailedContent` as separate UI/timeline display data. The ledger uses only `content`; neither field proves complete information or later model use. There is no verified generic truncation flag for these contracts. Telemetry, error prose, output filenames, ellipses and content length are not used to invent one.

A requested `view_range` beginning after line 1 or ending before the EOF sentinel, positive `grep.head_limit`, positive web start index or explicit web maximum length is labeled **requested scope limited**. This is distinct from confirmation that the host truncated output. A request for lines 1 through EOF still leaves returned extent unknown. Search content is snippets; file-list and count output are not file contents. Missing search mode stays unknown rather than adopting a presumed default. Patterns and arbitrary result prose never create additional resource claims.

## Identity, retention and navigation

An occurrence requires one complete unique start and at most one complete matching result, using exact source-agent and tool-call IDs in the attached session. Raw and projected event identities, timestamp, call ID and tool name must agree. Duplicate starts/results, another agent's same call ID or an evicted start cannot supply a result's request basis.

The overview counts operation occurrences separately from distinct recorded target references. A reference key is the exact tuple of source-agent ID, path/URL kind and literal argument string. Two reads of the same string in the same source are two occurrences and one reference. `./file`, `file`, case variants, URL spellings and another agent's same path remain separate references. Failed and pending requests also contribute their recorded targets. This is not a count of unique physical files: no canonicalization, case folding, current-directory assumption or filesystem lookup occurs. Repeated entries in a `paths` array remain visible, while the distinct-reference count deduplicates their exact keys.

The ledger is recomputed from Trace's retained window of at most 300 supported events, each with at most 12,000 UTF-16 code units of evidence. It does not cache evicted content. Incomplete/unavailable history and omitted older events are disclosed; no matching rows means no recognized retained requests, not no retrieval activity in the chat. Unclassified calls retain their original source buttons.

Source navigation uses the existing original-event path: it closes Statistics, pauses Follow live, switches to Chronological events, resets filters and opens the exact retained evidence. An expired or changed source is rejected without moving the reading position or closing the panel. Unchanged rows preserve disclosure state, keyboard focus and scroll across updates; a removed focused row falls back to the ledger list. Literal Unicode and markup are rendered with `textContent`.

## Verification and limits

`test/retrieval-ledger.test.mjs` covers mixed returned/failed/empty/missing outcomes, requested ranges and limits, search modes, repeated and source-scoped references, Unicode and external references, custom/MCP ambiguity, malformed/clipped/conflicting boundaries, the 300-event window and nontext/display-only results. `test/app.test.mjs` covers literal rendering, late completions, same-ID updates, disclosure/focus/scroll retention, source eviction, and evidence navigation through all views and filters. Existing asset, server and package checks cover the modified shipped modules; no new endpoint or asset was added.

The installed-runtime fixture's sixth disposable session uses two fixed loopback model responses for three owned retrieval attempts: a view of lines 3–5, a content search limited to two results, and a view of a missing path. It checks actual Trace projections and ledger rows against the recorded events. The missing path returns failure diagnostic text, which the ledger excludes from retrieved content. No paid inference, private session, external retrieval or native UI automation is involved.

Owner-performed native acceptance is deferred for the November 20, 2026 overnight run. Pending checks are collapsed/expanded ledger readability, narrow and short panes, enlarged text, keyboard and screen-reader access, source navigation, live focus/scroll retention and source eviction in Copilot. DOM tests do not establish native layout or accessibility acceptance. Independent review, automated iteration verification, packaging and publication remain required; the issue stays open until manual acceptance is recorded.
