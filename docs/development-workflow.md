# Development workflow

Use one short brief, one implementation owner, an independent reviewer, and fresh check evidence for each completed iteration, including documentation and instruction changes. The commands below keep routine coordination small; [AGENTS.md](../AGENTS.md) remains authoritative for host safety, installation and publication. Adapted from Explorer with owner-recorded UI acceptance to respect this repository's restriction on UI automation. This workflow requires no additional skill installation or dependency.

## 1. Define the iteration

Read the issue and relevant code, then run:

```powershell
npm run iteration -- start issue-123
```

Fill `.iteration/issue-123/brief.json`: summary, observable acceptance criteria, implementation agent identity, and explicit `ui` / `host` booleans. Use a descriptive slug when there is no GitHub issue. Add relevant file paths, exclusions and risk notes to the summary or acceptance criteria rather than copying the conversation. Keep blocked requirements and deferred issues intact.

`ui` means the change affects visible layout or interaction. `host` means it changes Copilot SDK/runtime integration. These are declarations checked by the reviewer, not an automatic classifier. A false declaration can omit a necessary gate; classify uncertainty conservatively. Ordinary documentation/tooling changes can set both false.

For an ambiguous UI change, agree on one small viewport-level prototype before polishing the implementation. Specify where the interaction lives (card, pane or whole screen), the common user action, and what remains behind optional controls. Record acceptance for collapsed/expanded, narrow/short, keyboard/focus and overflow states. A DOM test does not establish usable rendered geometry. Straightforward fixes with clear expected behavior need no new prototype ceremony.

## 2. Implement with bounded context

- Keep roadmap issues sequential. The owner-authorized repository workflow requires separate implementation and review agents; one implementer owns a given file set at a time. A worker does not launch a duplicate reviewer.
- Give a fresh agent the brief, relevant paths and necessary constraints. Reference earlier evidence instead of copying history. Preserve useful existing model routing; change models only as a separately measured pilot.
- Return changed paths, acceptance status, check results, unresolved findings and evidence references. Keep full logs on disk. Read bounded file sections and failure excerpts; if output is truncated, narrow the next read.
- Use completion notifications and consolidate actionable messages. Do useful local work while an agent runs; retain required user updates and bounded waits. Waiting and necessary corrections are not automatically waste.
- Run focused checks while editing. Run full required gates on the reviewed final candidate, and rerun when code, requirements or evidence changes. A failure gets diagnosis, not weaker assertions.

Keep a small progress record with the current task, candidate, next action and evidence paths. After context loss, consult that record and Git history before redispatching work. `.iteration/` and `.superpowers/` are ignored; raw journals, screenshots and detailed tool output belong in local evidence, not Git.

## 3. Review the final candidate

Finish release metadata before requesting final approval. Give the independent reviewer the brief, bounded diff, relevant source and test evidence. Review correctness and specification together; include risk-specific paths such as persistence, cancellation, authorization and UI reachability. Reviewers may request additional checks when evidence is missing; they need not repeat unchanged passing commands simply to generate another receipt.

Collect findings in one fix request. Reuse the implementer's context for fixes; rereview the changed scope. Preserve review independence and resolve blocking findings. A cost target cannot convert an unresolved defect into approval.

After an independent reviewer approves, record their ordinary local report:

```powershell
npm run iteration -- review issue-123 independent-reviewer .iteration/issue-123/reviewer-report.md
```

Use the actual agent identity, distinct from `implementationAgent`. The command copies the evidence and binds the attestation to the candidate and brief. It records an approval the caller has received; it cannot establish reviewer identity or thoughtfulness. An unresolved review is not an approval command. Keep the report nonempty and give the verdict, findings, checks considered and limitations.

## 4. Verify and publish

```powershell
npm run verify:iteration -- issue-123
npm run iteration -- status issue-123
npm run package
```

Verification runs `npm test` and `npm run check`, plus `npm run e2e` for declared host changes. Declared UI changes also require owner-performed visual acceptance recorded against the same candidate and brief. Save the owner's actual results, tested states and remaining limits in a local report, then run:

```powershell
npm run iteration -- ui issue-123 .iteration/issue-123/owner-ui-report.md
```

This command records acceptance already received; it cannot perform a visual check or prove who authored the report. Record it only after the owner confirms the required UI checks pass. Missing, altered or stale UI evidence blocks verification. Explorer's product-specific `check:ui` browser suite and `--allow-ui` flag are not used here. Do not automate browser/desktop UI without an explicit request; use Brave if authorized and still distinguish browser-layout evidence from native-host acceptance. Missing runtime prerequisites and failed checks are failures, never silent passes. The SDK fixture uses the installed runtime and disposable local fixtures, not a paid provider or an existing user session.

Console output is a compact result with evidence references. Full command output and hashes stay under `.iteration/<id>/`. On resume, run `status` first: reuse fresh passing evidence unless a new requirement or unresolved concern warrants more checks. `verify` deliberately reruns the gates when invoked. `status` checks candidate content, requirements, approval and check evidence. New/deleted/edited source files, changed briefs or modified logs invalidate readiness; edits during checks also fail. A content-preserving commit can retain readiness. After interruption, inspect the receipt and any lock before retrying; do not delete a live verifier's lock.

Ready means the candidate has recorded fresh checks and approval. It does not mean published or fully accepted on real hardware. Run any additional acceptance required by the issue, and explicitly report manual exclusions (for example microphone, live model, screen reader or IME). The helper does not attest these by implication.

Follow AGENTS.md's release steps: synchronized version and notes, required gates, package validation, safe integration, push to main and remote commit verification. Fetch before publication. Integration that changes tested content needs fresh review of the delta and fresh gates. The CLI neither commits nor pushes. Keep the final commit/version and remote verification in the completion report. Never overwrite another worktree's unfinished changes.

## 5. Record measured usage when available

Usage is optional evidence, not a completion gate. Explicitly import an aggregate entry from a trusted usage record:

```powershell
npm run iteration -- usage issue-123 .iteration/issue-123/usage-entry.json
```

The entry has `id`, `model`, `source`, `inputTokens`, `cachedInputTokens`, `outputTokens`, `coordinationCalls`, `reworkCount` and `phase`. Use a unique stable entry ID and a source reference. Phase is `implementation`, `review`, `coordination`, `rework` or `setup`. Token counts must be measured nonnegative safe integers with cached input no greater than total input. Coordination/rework counts may be `null` when unknown. If token counters are unavailable, leave usage unrecorded and report that limitation.

Cached input is included in input; fresh input is input minus cached input. Reasoning is already part of output. Totals remain separated by model; repeated entry IDs are rejected. Each imported aggregate must cover a disjoint set of responses: different IDs do not prove nonoverlap. Do not import both parent totals including children and those same child totals. The tool never discovers private sessions or converts tokens to an invented bill. An import source reference is provenance supplied by the caller, not independently audited attribution.

Use an ignored file for usage inputs as well as outputs. Include automation setup and rework in the pilot cost; keep private text and full transcripts out of usage entries. Use actual model rates or billed charges for monetary comparisons, preserving the distinction between cached and fresh input.

## Evaluate workflow changes when trialed

Compare issues by scope (UI, ordinary feature, host/security) and record fresh/cached/output tokens, coordination responses, review findings, rework, and regressions over the same seven-day observation window. Include setup cost when calculating payback. Required checks, independent review and acceptance coverage stay constant. A small sample can support continuing a change; it cannot prove identical quality.

Keep `.iteration/<id>/completion.md` with: acceptance results; review findings and fixes; verification receipt; published version/commit; manual checks pending; usage source or unavailable; and regressions observed through the dated seven-day window. A window that has not elapsed is pending, not zero regressions. This short record is the handoff and pilot comparison input; do not recreate the transcript.

Start with brief/receipt discipline, bounded reads and consolidated coordination. Trial model routing separately so its effect can be distinguished. Roll back a process change if it causes lost context, missed requirements or extra regressions. Explorer's ten-issue experiment and modeled savings are historical context, not Trace targets or promised cost reductions.
