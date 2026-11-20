# Partial reads, excerpts and shortened results

**Scope and limits** in existing tool details and the Information retrieval ledger separates four different limits. It keeps **Unknown coverage** visible because the supported records do not establish a resource total or trustworthy returned coverage. It never merges overlapping reads, calculates a percentage or claims that an entire file reached the model.

| Label or scope | What the record establishes |
| --- | --- |
| Requested limited scope | A recognized request selected a line range, search excerpt, result limit or web character range. This is a request, not proof of what returned. |
| Host-shortened preview | A validated `result.contents` block of type `shell_exit` records `outputTruncated: true`. This establishes an incomplete shell output preview, not a generic truncation rule for every result field. |
| Trace-clipped evidence | Trace clipped this event's raw JSON to at most 12,000 UTF-16 code units, including its ellipsis, without splitting a surrogate pair. This can occur independently of host shortening. |
| Retained-history limit | Trace retains at most 300 events. The omitted-event count concerns event retention, not how much output a tool returned. |

The original retained JSON remains under **Recorded evidence** and behind the ledger's original-source buttons. A clipped JSON prefix is not repaired. No recorded file, output path, URL, current skill or project is read to fill gaps.

## Requested and returned measurements

`toolExtents(entries, snapshot)` in `web/presentation.mjs` shares the operation contracts and exact boundary validation used by the ledger. Every supplied request argument must match its supported contract. Unknown tools, unsupported fields, MCP aliases, explicit custom-origin evidence and ambiguous or clipped boundaries do not gain a recognized request classification.

| Request field | Displayed meaning |
| --- | --- |
| `view.view_range: [first, last]` | Exact 1-based inclusive line range. `last: -1` means a request through EOF; it is not proof that EOF was returned. |
| `view.forceReadLargeFiles` | Whether a large-file limit override was requested. Neither value proves a complete read or an actual byte count. |
| `grep.output_mode` | Matching-line excerpts, matching file paths or per-file counts. Missing mode remains unrecorded. |
| `grep.head_limit` | First N **results** requested. Results are not assumed to be lines, files or bytes. Zero is displayed literally without assuming an undocumented meaning. |
| `grep.-A`, `-B`, `-C` | Requested context **lines** after, before or around matches. These may interact; Trace does not sum them into returned coverage. |
| `grep.-n` | Whether line numbers were requested. |
| `web_fetch.start_index`, `max_length` | Exact requested pagination index and maximum **characters**, using the contract's unit without converting to bytes or JavaScript string length. |

The helper can measure the retained `result.content` string in **UTF-16 code units**, separately from those request units. A supplementary Unicode character occupies two code units; this is not a byte, token, line or resource-coverage measurement. The same measurement for a typed shell preview is labeled separately. No line numbers, match totals or filenames are extracted from result prose.

Successful empty text is a zero-length response, not evidence of an empty file or search space. Failed output remains diagnostic evidence and cannot become a successful retrieval. The host's `detailedContent` is separate display data; its length or difference from `content` cannot establish truncation or complete delivery to the model. False or absent shell preview flags also leave general output completeness unknown.

## Bounded host fact

The installed SDK declares `ToolExecutionCompleteContentShellExit` under `ToolExecutionCompleteResult.contents`. Its `outputPreview` may be partial; `outputTruncated: true` explicitly identifies an incomplete preview. Top-level `shellExecution` exposes `exitCode`, not this flag. Arbitrary telemetry, invented `result.truncated` fields, ellipses, prose and output filenames are not accepted substitutes.

`web/host-output.mjs` is shared by the observer and presentation. It inspects at most 64 structured blocks and requires exactly one valid shell-exit block, a boolean success value, string result content, a bounded shell ID, safe-integer exit code, optional string preview and optional boolean flag. Malformed block envelopes, duplicate shell exits, oversized collections and invalid event/call/source identity are rejected. Optional preview absence yields an unknown preview length; it does not invalidate an otherwise explicit shortening flag.

For a true flag, the observer retains only event ID, source-agent ID, call ID, timestamp, the `shell_exit` discriminator, the true flag and optional preview code-unit count. IDs are nonempty and at most 256 code units; absent source means the main chat. A malformed or oversized explicit source is rejected. This small projection contains no preview text, shell ID, output path or raw exception. Complete raw evidence is checked against it again before presentation. When JSON is clipped, the UI identifies the fact as a separate validated projection of the original event, not recovered raw JSON. It can survive even when the call must remain unclassified in the ledger.

Original-source identity includes this projection, so a changed fact beyond an identical clipped prefix invalidates an older navigation target. Reparsed unchanged snapshots retain their source identity. Existing disclosure, focus, scroll and Follow behavior is preserved.

## Verification and remaining limits

`test/partial-evidence.test.mjs` covers overlapping ranges, missing totals, excerpts and modes, character/line/result/unknown byte units, empty responses, failures, Unicode, malformed or ambiguous host flags, the 64-block bound, both shortening layers, the 300-event limit and changed-source rejection. `test/app.test.mjs` covers labels in both existing surfaces, literal rendering, original evidence access, late updates, focus, disclosures, scroll and eviction. The shared helper is an allowlisted shipped asset, covered by the server and installed-runtime fixture.

The installed-runtime fixture's existing approved shell operation emits bounded output after writing its owned disposable file. It observes a true shell flag and a 500-code-unit preview, checks the joined Trace projection and descriptor, then checks a fresh observer's immediate history. This does not establish disk-resumption persistence. The retrieval phase checks the actual line-range and search-result requests separately. The retrieval checks finish after fourteen fixed loopback responses across the first six disposable sessions. Later fixture phases are described in Copilot integration. These checks use no paid inference or private user session.

Owner-performed native UI acceptance is deferred for the November 20, 2026 overnight run. Pending checks are readable scope labels in expanded details and ledger rows; narrow/short panes and enlarged text; keyboard, focus and screen-reader behavior; original-source navigation; and live-update/eviction behavior in Copilot. DOM tests do not establish native rendering or accessibility acceptance. Independent review, automated verification, packaging and publication remain mandatory; the issue remains open until manual acceptance is recorded.
