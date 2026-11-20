# Live evidence implementation plan

Implement the approved [proof of concept](../specs/2026-11-19-live-evidence-design.md) in this existing worktree, with one implementation owner and a separate final reviewer.

1. Add failing tests for `createTrace(session)` in `test/trace.test.mjs`. It returns `ready`, `snapshot()` and `close()`; snapshots contain revision, history status, omitted count and projected entries. Cover overlap, failure, disposal, bounded data and honest attribution.
2. Implement `trace.mjs` with `session.on` installed before `getEvents`, supported event projection, bounded memory and literal evidence. No session mutation calls. Keep raw IDs for correlation and never use `parentId` as causal evidence.
3. Pass the owning session from `canvas.mjs` to `startServer(session)`. Serve a protected `events` JSON endpoint and browser module; use ETag/304 for unchanged snapshots. Close the observer with the server. Extend HTTP tests for authentication, CSP, methods and disposal.
4. Replace the starter page with chronological expandable steps and turn dividers. Poll serially with timeout, retain expanded nodes/focus, display connection/history failures and retention limits, and stop following when inspecting evidence. Use semantic HTML, textContent, responsive CSS and light/dark colors.
5. Extend the installed runtime fixture to verify actual history and live delivery without paid inference or existing sessions. Update documentation and launch skill to describe the implemented limits; synchronize version 0.1.2 and release notes.
6. Run unit/check/e2e, obtain independent review, fix findings, package, and request the concrete owner UI checks. Record only actual acceptance. Run the full iteration gate, then commit/integrate/push and verify origin/main when the gate is satisfied.

## Review focus

- History racing live delivery cannot duplicate or drop retained events.
- Disposal during pending history cannot revive a closed observer.
- No missing field or unknown trigger becomes an invented reason.
- External origins and invalid capability/Host cannot read session content.
- Expanded evidence and keyboard focus survive background updates; manual geometry remains an explicit gate.
