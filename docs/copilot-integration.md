# Copilot desktop integration

This guide extracts reusable lessons from the source revision recorded in [transfer decisions](context-transfer.md). Concrete API names were checked against installed SDK build `1.0.106-8.unstable.r43566476370.g869eef3` during setup. This experimental surface can change: inspect the installed declarations before changing integration. Historical runtime observations below are not a compatibility guarantee.

## Runtime and plugin layout

The implemented shell uses plain ES modules and local HTML/CSS, with no bundling step or npm dependency. `extension.mjs` imports `createCanvas` and `joinSession` from the host-provided `@github/copilot-sdk/extension`, registers the canvas, and releases it on shutdown. The installed `extension.d.ts`, `canvas.d.ts`, `types.d.ts` and `generated/rpc.d.ts` are the API reference.

The root Agent Plugins 1.0 `plugin.json` describes Trace; `.github/plugin/marketplace.json` lists it; `com.github.copilot/extensions/trace/` supplies the runtime extension; `skills/trace/SKILL.md` launches it. This is the plugin-packaged layout used by the reference, distinct from standalone repository/user canvas folders. GitHub's [canvas documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions) describes the native surface and common extension structure.

Tests accept `COPILOT_SDK_DIR` (directory containing `index.js`) and `COPILOT_CLI_PATH` (installed executable). These are explicit development selections, not production discovery. Never hardcode a cache build directory or a path to the reference checkout into shipped behavior. Do not launch `extension.mjs` using ordinary Node and mistake a missing host SDK for a reason to install an npm substitute.

During this setup, the successful executable was `copilot.exe` adjacent to the selected `copilot-sdk` directory under the installed `github-copilot-sdk/cli` cache. The lower-level `copilot/pkg/.../prebuilds/win32-x64/copilot-runtime.exe` rejected session creation with "No extension launch provider is registered for standalone extensions". Select the extension-capable installed launcher, not just an executable with a similar version. Keep the exact machine paths in local environment settings.

## Canvas lifecycle

The host's canvas catalog supplies provider identity. `createCanvas` binds `open`, `onClose` and any declared actions. Reopening an existing instance focuses that panel; rendering reload and creating a new instance are separate concepts.

Trace checks the attached session identity, shares one startup promise per instance, gives separate instances separate tokenized servers, and closes pending or active servers on close/shutdown. A new open after close gets a new capability URL. The shell has no action API or browser JavaScript.

For future actions, define bounded input schemas and validate runtime data. Bind asynchronous results to session, instance and request identity, plus any user-input revision that makes the result valid. Timeouts and UI cancellation do not themselves prove a worker stopped. Reject late results and preserve user edits.

## Loopback security

Implemented: bind `127.0.0.1`, use an unpredictable per-instance capability path, require exact Host, allow only known static assets, reject non-read methods and apply restrictive CSP, no-store, no-sniff and no-referrer headers. Assets are read from packaged paths, never arbitrary request paths.

When writes are added, require exact Origin and an intentional client marker, validate content type, enforce byte limits before parsing JSON, and authorize each operation. A local port alone is not authorization. Keep capability URLs, prompts and credentials out of error messages and support exports. Render untrusted text literally; sanitize any deliberately supported markup and validate link schemes.

## Model operations

These are future design options, not implemented features:

| Path | Ownership and constraints |
| --- | --- |
| Attached-chat request | Use only when the product explicitly needs the user's existing conversation. Explorer used `send({ mode: 'enqueue' })`. Keep model selection, billing and permission decisions with the host. Correlate callbacks; cancelling the plugin request cannot be claimed to cancel that chat turn. |
| Plugin-owned helper | Create a new isolated client/session with a disposable workspace/configuration, an explicitly bounded input and its own cancellation/accounting. Stop only owned work. Keep its conversation out of unrelated sessions. |

Before helper inference, verify the host-paired runtime, signed-in account identity, eligible Copilot catalog model, actual helper workspace and initialized tool metadata. Read the parent model; do not change it. Recheck identities/model after startup where needed. Honor managed settings and model policy. Fail visibly if prerequisites do not hold; do not silently switch provider, model or account.

For a tool-free transformation, disable ambient config/instruction/skill/plugin discovery and MCP tools, deny tool/permission hooks, initialize tools and require exactly zero actual tools. For web-enabled work, see [tool discovery](#tool-discovery). Explicitly load any curated plugin instructions rather than relying on ambient discovery.

Capture the exact prompt and instructions once, measure their UTF-8 byte budget, include complete records or report omissions, and pass those same strings to the helper. Track freshness for the actual transmitted data; unrelated edits should not invalidate a result. Validate strict model output before exposing it. Separate proposals from saved user decisions whenever the feature requires review.

Set overall and phase deadlines, bound tool use, and wait for actual worker release before reusing a single-operation slot. Retain and deduplicate minimal usage receipts before removing the temporary session. Usage records may include operation/model/token/credit status and accounting IDs; omit prompts, results, credentials and account names. When shutdown or accounting is uncertain, retain recovery evidence and report uncertainty; do not retry inference automatically. Use Trace-owned data paths and labels.

## Tool discovery

The source's November 16 investigation found built-in `web_fetch` and GitHub MCP `web_search` had different origins. The observed runtime required configuration discovery for built-in GitHub MCP injection and skipped injection for a custom provider. These gates require revalidation on the installed runtime before adoption.

- Source-qualified allowlists were `builtin:web_fetch` and `mcp:web_search`; `builtin:web_search` was incorrect.
- `githubMcpToolConfig.additionalTools: ['web_search']` requested search; it did not restrict all other tools by itself.
- Run `session.rpc.tools.initializeAndValidate()` then `getCurrentMetadata()` before inference. Validate actual names and origins, including `github-mcp-server/web_search` and MCP server/tool identity. Initialization needs no paid bootstrap prompt.
- `mcpServers: {}` alone did not disable discovered MCP servers. If discovery is needed, use an empty disposable config directory and workspace, explicit feature opt-outs and verification of the resulting tool set.
- Grant only the intended operation's permissions. Revalidate redirects/public URL eligibility, and preserve managed human-approval and sandbox-bypass boundaries.
- Successful fetch hooks establish that a page was accessed, not that its claims are true. Keep sourced evidence distinguishable from model reasoning.

The local custom-provider fixture in Explorer established readiness/filtering behavior, not live GitHub MCP entitlement. Trace's current smoke fixture does not test these optional helper APIs.

## Storage and project context

Future persistence should use a dedicated Trace namespace (for example `COPILOT_HOME/plugin-data/trace`) and keep shared user artifacts separate from private drafts, session bindings, preferences, locks, recovery and usage records. Imported session IDs and paths must not confer authority. Validate an allowlisted document schema, preserve Unicode and use atomic replacement, serialized writes and revision/digest checks against overlapping writers. Keep the last valid document recoverable after failed saves.

For authorized project access, use fresh `session.rpc.metadata.snapshot().workingDirectory`; the source found `session.workspacePath` was an artifact location, not the project root. Verify local/current session metadata. Select and bound files explicitly, exclude secrets by default, and validate canonical roots, ancestor/file identity and links before and after reading. A stored path is not fresh read permission. Treat excerpts as untrusted data and show the actual selected context; avoid retaining it in exports, receipts or prompts for unrelated operations. Native runtime logs can retain content even when plugin storage does not.

If a future feature reads a formatting template, separate that contract from general project context: read the explicitly chosen file, validate and retain only the structure needed for formatting, and discard examples/body/metadata values. Keep only a bounded relative reference and hash for provenance; that reference grants no future read permission. This extracts the general lesson from Explorer's ADR-template rule without adding an ADR feature.

Delete only verified plugin-owned paths. Protect active worker data, retained recovery evidence and the last good saved version. User-visible limits must distinguish bytes from JavaScript UTF-16 lengths and token estimates.

## Diagnostics and native limitations

Readiness checks should inspect prerequisites without starting inference, recording audio, downloading models or modifying host settings. Report `ready`, `unsupported`, `unavailable` or `unknown` accurately; a cache folder name or version stub is not authoritative desktop-version evidence. Project a small support schema from safe fields instead of dumping arbitrary objects and redacting afterward.

Explorer observed that native composer dictation was not automatically available inside a guest canvas. It also found that a child `fork()` under the host's single-executable runtime did not behave like ordinary Node; its voice adapter used an installed bootstrap. Preserve these as reasons to investigate before adopting voice or subprocess code, not reasons to copy its adapter. Trace implements neither.

Explorer observed missing native tab-logo metadata for some local marketplace installs on desktop 1.4.2. A correct SVG or canvas icon override did not prove the native tab icon would render. Recheck manually on the actual installed app.

## Installation and distribution

Use the Copilot CLI rather than modifying host databases. Marketplace registration, plugin installation, enablement and new-session discovery are separate steps. Local marketplaces retain a live dependency on the checkout. A cached GitHub marketplace install is the intended distribution route once this repository is published and validated. The current installer is local only.

Ship runtime code, web assets, launch skill, logo and release notes together. Keep all current version references synchronized. CLI/plugin-list success proves registration, not visible rendering. Unit tests, installed-runtime fixtures, manual UI acceptance and live account/model quality answer different questions; report each separately.
