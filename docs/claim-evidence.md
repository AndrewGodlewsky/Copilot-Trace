# Assistant claims and recorded results

Open **Assistant claim and recorded results** inside a recognized assistant message. The disclosure preserves the exact statement and offers candidate check results for inspection. **Link this result** records your choice beside the statement as **User-linked result, not verified**. **Remove user link** clears that choice. Original-evidence buttons show the statement, command and result in their recorded timeline positions.

Candidate evidence does not establish support. A selected result remains your association, including when its process exit disagrees with the statement. Trace displays the two facts without assigning a truth score, claiming dishonesty or deciding whether the whole task succeeded. Opening the disclosure or selecting evidence pauses Follow.

## Recognition and candidate rules

Recognition accepts exactly these six complete `assistant.message.data.content` strings:

| Category | Reported pass | Reported failure |
| --- | --- | --- |
| Tests | `Tests passed.` | `Tests failed.` |
| Build | `Build passed.` | `Build failed.` |
| Checks | `Checks passed.` | `Checks failed.` |

Case, spaces, punctuation and the entire string must match. There is no trimming, sentence extraction or interpretation of prose. Surrounding text, quoted examples, multiple sentences, extra newlines, other languages and claims inside a split response remain ordinary evidence. Both `chunkIndex` and `chunkCount` must be absent, as documented for an unsplit response. Any present chunk field is excluded, including index zero with an unknown total or conflicting chunk metadata. The original text is never rewritten. Complete raw evidence must match a unique event ID, source, timestamp and event type; clipped or conflicting claim records are not classified.

Candidates require a unique retained `powershell` start and completion sharing an exact source and tool-call ID, with the start before its completion. Only these literal commands are recognized:

| Command | Category |
| --- | --- |
| `npm test` | Tests |
| `npm run build` | Build |
| `npm run check` | Checks |
| `node --test` | Tests |
| `node --test PATH` | Tests |

`PATH` is one unquoted token beginning with an ASCII letter, digit, underscore or dot, then containing only those characters, slashes, backslashes or hyphens. For example, `node --test validation.test.mjs` is supported. Extra options, shell composition, interpolation, quoting and other commands are not parsed. The full command remains visible; similar suite names are never treated as equivalent.

The arguments require a nonempty command and a nonempty description of at most 100 characters. Optional supported fields are positive integral `timeout_ms`, `mode: "sync"`, a nonempty bounded `shellId`, `detach: false`, and numeric `initial_wait` from 30 through 600. Unknown or malformed fields are excluded. MCP/provider markers, including malformed markers, are excluded from this ordinary-command rule. An absent marker does not prove a native implementation: provider and implementation origin remain unknown.

The claim and each candidate must share the exact recorded source and category. Agents with similar names stay separate. Repeated commands are separate candidates. Trace shows the first three eligible results in recorded order, states how many additional candidates were omitted, and retains any explicitly selected result if it moves outside that first three. Every original record remains available in the timeline. Candidate selection makes no assertion about chronology, purpose or whether a result belongs to the statement; even a result recorded after the statement is only a candidate.

## What the result establishes

The literal `result.content` is displayed as text, including Unicode, markup and line breaks. An empty string stays empty. Missing or clipped content is labeled unavailable; Trace does not reconstruct it from previews, current files or `outputFilePath`. The original result record remains inspectable. Neither `PASS` text nor text resembling JSON supplies authoritative assertion counts or process status.

Tool protocol success is read separately from a typed process exit. A process status requires exactly one valid `result.contents` block with `type: "shell_exit"`, a bounded nonempty `shellId` and a safe integer `exitCode`. Optional preview, shortening and working-directory fields must have their declared types. Duplicate, malformed, absent or conflicting status records leave the exit unknown. If `shellExecution` is also present, its typed exit must agree. Telemetry values and prose do not fill missing status.

Exit zero describes this recorded command. It does not establish which assertions ran, which package script was configured, complete suite coverage, a correct implementation or whole-task success. The literal command and original request expose the available scope; Trace does not read project configuration or execute anything to expand it. A nonzero exit can coexist with tool protocol success. When a user-linked passing claim has a nonzero exit, or a failing claim has exit zero, the display names that disagreement without an automatic verdict.

`shell_exit.outputTruncated: true` identifies a known shortened preview. Even a false or absent flag does not guarantee complete process output. If Trace clips the raw event at its 12,000 UTF-16 code-unit limit, the descriptor keeps the known command but leaves process status, tool status and literal output unknown. The existing validated host-shortening projection may still disclose that separate fact. A missing start cannot acquire a reconstructed command; a missing completion offers no result candidate.

**Supporting result not found in this view** means there is no eligible retained result. It does not establish that no check ran. Unsupported commands, unavailable history and omitted older events can all leave gaps.

## Association lifetime and SDK limits

A user link freezes the exact statement, start and result records, including their source, raw evidence and projected metadata. Every refresh and action rechecks all three against unique currently retained records and the supported source/call/category rules. Changed same-ID records, duplicate boundaries, changed sources or eviction invalidate the link. Stale controls cannot silently point to replacements. Links, candidate controls and their retained references are cleared on eviction or panel close; they are local to the current panel, with no transcript archive or persistence.

The shared deterministic descriptors are `validationChecks(entries)` and `validationClaims(entries, options)` in `web/presentation.mjs`. They only inspect retained evidence. `linkValidationClaim` and `retainedValidationLink` enforce the user-association lifetime. No product model call, check execution, inventory query or cross-chat access is added.

The inspected installed SDK build is `1.0.106-8.unstable.r43566476370.g869eef3`. Its `generated/session-events.d.ts` defines typed `shell_exit` status and optional preview limits. It does not document a generic link from a reported validation claim to a check result. `CitationSource.id` is turn-scoped, while `CitableSource.id` is stable within one tool result; the declarations describe future provider correlation, not a generic equality with tool-call or event IDs. `causalDependencies` records consumed assistant messages across agents. Chronological envelope `parentId` records order. None supplies a validation-support association here.

## Verification and pending native checks

Disposable unit and DOM fixtures cover exact and ambiguous claims, repeated checks and similar suite names, separate agent identities, typed exit disagreement, missing/clipped/shortened output, malformed and duplicate identities, literal adversarial text, user links, stale controls, eviction, and panel cleanup. They exercise retained focus, scroll, disclosures, Follow, filters and view changes.

The installed-runtime fixture's eighth disposable session runs the owned deliberately failing `node --test validation.test.mjs` through one exact permission and two fixed local responses. The actual result reports tool success with typed exit `1`; the fixed assistant statement is `Tests passed.`. Actual joined Trace evidence and the descriptors are compared with the raw events. The result remains a candidate until a fixture explicitly creates a user link; that link expires when its evidence is removed. The complete fixture uses 22 fixed responses across eight disposable sessions, with no paid inference or private sessions.

Owner-performed native acceptance remains pending under the authorized deferral: interpretation of candidate versus user-linked evidence, claim/output clarity, long text, narrow and short panes, 150% text, keyboard/focus, live updates and eviction. DOM fixtures and runtime checks do not establish native rendering or assistive-technology behavior.
