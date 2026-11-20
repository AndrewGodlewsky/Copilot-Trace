# Validation checks observed

Open **Statistics → Validation checks observed** for a compact list of recognized validation requests in the retained timeline. Each attempt shows its literal command, exact source and call ID, recorded start/result times, tool protocol status and typed process exit. Expand an attempt for its output, limits and original-evidence buttons. Opening the disclosure or an original event pauses Follow.

**No validation observed here** describes this retained evidence window. It does not establish that no validation ran. Trace retains up to 300 events, and the overview names omitted history, unclassified calls and boundaries whose identities are unusable. Filters hide timeline rows; they do not change this overview's scope.

## Recognized requests

The overview reuses the strict request and typed-exit descriptors used by [assistant claim evidence](claim-evidence.md). It recognizes these complete literal commands on an ordinary `powershell` request:

| Command | Category |
| --- | --- |
| `npm test` | Tests |
| `npm run build` | Build |
| `npm run check` | Checks |
| `npm run lint` | Lint |
| `node --test` | Tests |
| `node --test PATH` | Tests |

`PATH` is one unquoted token beginning with an ASCII letter, digit, underscore or dot; remaining characters may also include slashes, backslashes and hyphens. The entire command must match. Wrappers, shell composition, quoting, extra options and other command names remain unclassified. Trace does not read package scripts or infer their selected suites.

Arguments require a nonempty command and description, with the description bounded to 100 characters. The shared rule accepts the documented narrow optional fields: positive integral `timeout_ms`, `mode: "sync"`, bounded nonempty `shellId`, `detach: false`, and numeric `initial_wait` from 30 through 600. Unknown fields, malformed values and any MCP/provider markers are excluded. Missing provider metadata leaves implementation origin unknown; it does not establish a native implementation. Lint recognition does not add a new assistant-claim phrase.

## What an outcome means

**Tool protocol: success** and **Process exit: 1 (nonzero exit)** can both be recorded for the same operation. The former reports the tool's protocol outcome. The latter is the typed exit of the recorded command. A zero exit does not prove which assertions ran, full-suite coverage, a correct implementation or whole-task success.

Process status requires the existing unique, valid `result.contents` block with `type: "shell_exit"`, a bounded nonempty `shellId` and safe integer `exitCode`. Optional typed fields must be valid; a separate `shellExecution.exitCode`, when present, must agree. Missing, duplicate, malformed or conflicting status leaves process exit unknown. Prose, previews and text resembling JSON do not supply status or reliable assertion totals.

Test and suite assertion counts, skipped tests and coverage remain **unknown**: no authoritative complete result schema is inspected. `PASS`, partial suite summaries and skipped-test lines are displayed literally without becoming totals. Only retained `result.content` is displayed; an empty string remains empty. Preview shortening and Trace clipping are disclosed separately, and absence of a shortening flag does not prove complete output capture. Trace never reads an `outputFilePath` to reconstruct missing output.

A recognized start without a completion remains visible with an unknown outcome. It does not imply the check is still running. A missing start cannot acquire an inferred command. Incomplete or contradictory raw result identity, source, tool or provider evidence cannot acquire a result link or latest-result marker. Its original timeline boundary remains inspectable. Trace-clipped results can retain their matching projected boundary link while their process status, tool status and literal output remain unknown.

## Attempts, identity and latest results

Each usable exact source/call identity counts once, whether it has one retained boundary or two. Duplicate or reused identities remain unclassified and do not become multiple successful checks. Usable unclassified identities follow the same call-count rule as Statistics; unusable identities are disclosed as separate boundaries rather than an invented operation count. Agents with the same display name remain separate.

Repeated requests remain separate attempts. Earlier failures stay visible when another attempt has a zero exit. **Latest retained result** marks the last compatible completion in retained record order for that exact source and literal command. It does not establish the same shell, environment, package script or suite; original arguments expose the available differences. A later incomplete attempt does not replace a retained result. Missing or invalid timestamps are shown as unknown chronological time, and the original timestamp text remains available.

Original-evidence buttons recheck their exact retained record before navigating. Replaced, duplicate or evicted targets cannot silently point to a new record. Refreshes preserve existing attempt disclosures, focus and scroll where the record remains; eviction clears the row and moves affected focus to the retained list. Closing Trace releases the controls. No transcript archive, persistence, model call or validation execution is added.

The deterministic API is `validationOverview(entries, options)` in `web/presentation.mjs`. It returns `checks`, `unclassifiedCalls`, `unlinkedBoundaries` and scope `notes`. Checks include original `start`/`result` references, literal `command`, `source`, `timestamp`, `resultTimestamp`, `toolSuccess`, `exitCode`, `output`, `latestResult` and explicit `assertionCounts: null`. `validationChecks(entries)` retains its completed-pair behavior for claim candidates; the overview opts into incomplete requests through the same implementation.

## Verification and remaining native checks

Disposable helper and DOM fixtures cover strict test/build/check/lint recognition, wrappers, typed zero/nonzero/unknown exits, tool-success disagreement, partial and skipped-test prose, clipping, repeated and interleaved calls, invalid identities, missing boundaries/history, literal Unicode/markup, guarded links and reading-state preservation across updates, filters, views and eviction. The installed-runtime fixture uses an owned failing `node --test validation.test.mjs` operation: tool protocol success is true, typed process exit is 1, and the fixed assistant says `Tests passed.`. The overview keeps those recorded facts separate and assertion counts unknown.

Native UI acceptance is explicitly deferred for this run. Readability of result/scope labels, narrow and short panes, long output, 150% text, keyboard/focus behavior and live eviction still need owner-performed checks. Automated DOM checks and the installed-runtime fixture do not establish native rendering or live model quality.
