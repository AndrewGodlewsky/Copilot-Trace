# Working on Trace

Trace is a GitHub Copilot desktop plugin. `/trace` opens a live timeline of the current chat with expandable recorded evidence. The owner chose a small proof of concept using recorded evidence and general explanations only. Keep missing origins/reasons explicitly unknown; chronology is not causality. AI interpretation, transcript persistence/exports and cross-chat access are deferred. The footer supports user-requested export of bounded plugin diagnostics; keep those logs free of chat content, IDs, paths, URLs, raw errors and credentials.

## Integration and boundaries

- Before changing host integration, read [Copilot integration](docs/copilot-integration.md) and inspect the installed SDK declarations. The host supplies `@github/copilot-sdk/extension`; keep it external and do not download or bundle a replacement runtime.
- Shipped code lives in `com.github.copilot/extensions/trace/`: `extension.mjs` joins the host, `canvas.mjs` owns instances, `server.mjs` serves local assets and read-only snapshots, `trace.mjs` observes session events, and `web/` renders the panel.
- Validate session/instance ownership and correlate future async requests. Closing an instance must release its resources; stale results must not overwrite newer user input.
- Model operations are not implemented. Before adding them, read [session ownership and background helpers](docs/copilot-integration.md#model-operations). Keep parent model and permission ownership with the host; isolate and account for plugin-owned work.
- Keep HTTP bound to loopback, require the per-instance token, validate Host, and serve only allowlisted assets. Future write endpoints also need exact Origin checks, bounded JSON and request authorization.
- Validate untrusted input at boundaries. Render user/model content as text; link only validated HTTP(S) URLs. Preserve exact user text and Unicode.
- Before adding saved data or project access, read [storage and project context](docs/copilot-integration.md#storage-and-project-context). Use Trace's own data namespace, atomic saves, writer/revision checks and explicit project selection.
- Keep the panel usable in narrow/short panes, with semantic HTML, keyboard access and visible focus for interactive controls. Metadata logos use compact flat-color SVGs.

## Development and completion

Before implementing a repository change, read [development workflow](docs/development-workflow.md) once. Use its issue brief, independent review receipt, `verify:iteration` gate and explicit usage ledger when counters are available. Keep detailed logs under ignored `.iteration/`; reload only relevant sections when scope changes or context is lost. Token targets never waive checks, review, accessibility or release steps.

Run `npm test` and `npm run check`; for host changes also run `npm run e2e` with the installed SDK/runtime pair. Require a separate review agent for every completed iteration, including documentation changes. Use one implementer per file set and consolidate review feedback. Run `npm run package` before publication.

Tests must use disposable data and local model fixtures, never paid inference or existing user sessions. Missing prerequisites are a reported blocker, not a passing test. Native rendering, live model quality and account entitlement require separate evidence.

Respect the owner's global restriction: no computer-use or browser UI automation without an explicit request. Ask the owner to perform manual UI checks. Use Brave if browser opening is authorized.

When the owner explicitly defers manual UI acceptance for a stated run or scope, follow the [authorized deferral procedure](docs/development-workflow.md#authorized-ui-deferral). Keep visible changes declared `ui: true`, record the authorization and pending checks, and retain every automated/review/publication gate. A deferral is never a claim that native UI checks passed.

Install through Copilot's CLI; do not edit host databases or installed-plugin records. A local marketplace loads its checkout live, so retain that directory and start a new session after changes.

## Complete every iteration

The owner has given standing authorization to commit and push each completed iteration to `main`. Unless the owner explicitly requests otherwise, every iteration that changes repository files, including documentation or instructions, must finish with these steps:

1. Bump the plugin version at least one patch increment. Synchronize `package.json`, both root version entries in `package-lock.json`, `plugin.json`, `.github/plugin/marketplace.json`, `com.github.copilot/extensions/trace/package.json`, and the README's current version.
2. Every version must add a newest-first entry to `release-notes.json`: one or two very short user-facing sentences explaining what changed, at most 400 characters. The footer displays this file directly when the user clicks the version. Preserve all older entries, keep versions unique and descending, and ship the complete notes with the extension, panel, skill and logo.
3. Obtain independent review of the final candidate and run `npm run verify:iteration -- <id>`: unit tests and checks, plus the installed-runtime fixture for host changes and recorded owner UI acceptance for visible changes. Run `npm run package`. Fix failures before publishing; report unmet manual acceptance explicitly rather than claiming it passed.
4. Fetch remote changes, commit the iteration, integrate it into `main` without discarding others' work, and push to `origin/main`. Do not ask for push approval again or stop at a local commit or feature-branch push. Never force-push. Preserve other worktrees and unfinished changes; integration that changes tested content requires fresh review and checks.
5. Verify the published commit on remote `main`. Report the plugin version, commit, checks actually run and any pending manual verification. If publishing is blocked, state the blocker rather than claiming completion.

A passing runtime fixture does not prove visible desktop rendering or live model quality. Creating tags or GitHub Releases, or installing into the user's Copilot profile, remains separate from routine publication to `main`.

Report changes, checks actually run and remaining manual verification. [Transfer decisions](docs/context-transfer.md) distinguish adopted lessons from excluded Explorer behavior and link the inspected source revision.
