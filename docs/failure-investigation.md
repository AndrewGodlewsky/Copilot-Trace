# Readable events and failure investigation

Event details offer a lazy readable field view beside the exact retained JSON. Nested objects and arrays expand separately; strings keep actual line breaks and Unicode. The parser preserves duplicate members and numeric tokens rather than rounding or collapsing them. It accepts JSON whitespace only and stops at 12 levels or 400 fields. Clipped, malformed or larger structures use the original source fallback. All content renders as text.

## What Investigate sends

Opening a directly failed event prepares a read-only preview. No inference occurs until the user clicks **Investigate**. The preview shows the selected model/effort and expandable exact evidence. **Refresh scope** rebuilds an expired preview. There can be eight prepared previews per canvas; eviction requires refreshing an older one.

Direct failures use the same `recordedFailure` contract as failure markers, including validated nonzero typed process exits. The server selects the complete retained failure and at most one complete, unambiguous, same-source matching tool/hook/subagent start. Missing starts and partial history are disclosed. The evidence budget is 32,000 UTF-8 bytes; the final immutable prompt is limited to 40,000 bytes and instructions to 4,000. Clipped/protected/inconsistent records cannot be investigated. No neighboring conversation, project files, web retrieval or hidden reasoning is added.

The answer must be a JSON object with exactly four short text fields (`what`, `possibleCause`, `unknowns`, `nextCheck`) and nonempty unique references to supplied evidence. Each sentence is limited to 500 UTF-16 units and the entire response to 4,096 UTF-8 bytes. Unknown fields, duplicate keys, invalid references and invalid output are rejected before display. Text remains a labeled AI interpretation; structural validation cannot establish its factual accuracy or a cause. No repair or command is executed.

## Model and ownership

Settings remembers the exact eligible Copilot model/provider pair and reasoning effort across sessions. A fresh preference defaults to exact `claude-haiku-5.5`, selecting the highest recognized effort in its account-specific catalog (`max` when offered). Eligible selections must expose supported reasoning levels. Disabled, ambiguous, missing or unsupported selections fail visibly; no fallback is chosen. The parent model is read but never changed.

`owned-helper.mjs` resolves the SDK/runtime supplied by the desktop bootstrap. It creates an owned temporary workspace/configuration, an empty-mode client and a new session. Ambient configuration, instructions, extensions, skills, hooks, MCP, memory, host Git operations and retrieval are disabled; permission and pre-tool hooks deny work. Actual initialized tool metadata must contain exactly zero tools. The helper checks local workspace identity, session separation, account equality, exact provider/model, current effort and catalog eligibility again before sending.

Each canvas permits one running operation. The shared persistent receipt claim also prevents a new helper while prior release is unresolved. Requests bind the preview, request ID, exact retained evidence and settings revision. Displayed-prefix changes, learning/example modes, retention/replacement, settings changes, cancellation and closure invalidate results. Completion cannot overwrite a newer request. Setup phases have 20-second deadlines, the operation has a 120-second deadline and the first cleanup wait is 10 seconds. Late acquisitions remain tracked and get a second stop before files can be removed. A timed-out stop is not reported as release; the slot and persisted recovery state remain blocked until release is confirmed. There is no automatic inference retry.

## Storage and security

The private file is `COPILOT_HOME/plugin-data/trace/investigation.json`, or `~/.copilot/plugin-data/trace/investigation.json` when no home override is supplied. It contains a versioned preference revision and at most 100 content-free operation/model/effort/token/cleanup receipts. Saves use an exclusive writer lock, validation, a synced temporary file and atomic replacement. Linked/unsafe paths and unsupported schemas are rejected. Preference conflicts preserve the current version. Active or uncertain recovery records are not dropped to make room.

Usage accepts bounded live helper receipts with accounting source, sequence and usage identity. Exact repetitions count once; connected contradictory identities or values are excluded. Missing/inconsistent accounting stays unknown or partial, never zero or free. Reported input/output tokens are separate; no price or billing total is inferred. The ledger is saved before deleting runtime journals. A private owned temporary-directory name enables recovery investigation after failed release/accounting; imported names never authorize killing a process or deleting a path. Unresolved state is surfaced on reopening. Recovery requires establishing actual release, not clearing the receipt to claim success.

Trace does not save prompts or answers. Copilot runtime/provider logs can retain them, and failure to release or account for a helper can retain its temporary runtime files. Successful cleanup verifies the originally captured canonical directory and filesystem identity before removal. Diagnostics exports do not include this ledger or any content, IDs, paths, URLs, credentials or raw SDK errors.

The POST endpoint requires the per-instance capability, exact Host and Origin, an intentional client marker, exact JSON content type and an allowlisted schema. Bodies are limited to 4,096 bytes. The browser supplies an event ID/capture token, never prompt or evidence text. Read-only preview/settings calls cannot start inference.

## Evidence and pending acceptance

Unit/DOM/HTTP tests exercise parser fidelity, malformed boundaries, strict output, preferences, correlation, learning isolation, cancellation, late startup, cleanup and usage conflicts. The installed-runtime fixture follows the real HTTP-to-helper path for an actual retained failed test result. It verifies a separate session/workspace, initialized empty tools, high effort transmitted, one fixed local response, reported usage, unchanged parent model and cleanup.

That fixture uses explicitly synthetic auth/catalog/provider-identity adapters around a local provider. It proves neither live Haiku entitlement nor real interpretation quality. Native narrow/short layout, keyboard/focus, desktop lifecycle and actual account/model operation require separate owner evidence. UI automation and paid inference are not part of the automated suite. General Ask assistance, web/project research and cross-chat browsing remain deferred.
