# Tool provenance

Tool cards show **Origin: MCP** when a complete retained invocation records supported MCP metadata. A supplied provider display name appears beside the origin. Other cases show **Origin: Unknown**, including native built-in or plugin tools whose recorded events lack a verified origin discriminator.

Expand **Tool origin and provider** to see the metadata basis, the exact recorded identities and a link to the original invocation evidence. Source details remain separate from the tool result. An MCP label does not establish network activity, safety, authorization or successful effects.

## Supported evidence

The installed SDK/runtime pair `1.0.106-8.unstable.r43566476370.g869eef3` declares these fields on `ToolExecutionStartData` in `generated/session-events.d.ts`:

| Recorded field | Meaning in Trace |
| --- | --- |
| `mcpConfigServerName` | Explicit configured server key; preferred identity when present. |
| `mcpServerName` | Recorded server name. Current events use the configured key, but legacy events may use a display name. Without the explicit key, the exact configured identity remains unknown. |
| `mcpToolName` | Original tool name on the MCP server, separate from the model-facing `toolName`. |
| `mcpServerDisplayName` | Optional provider display name, shown literally. It is never a correlation key. |
| `mcpConfigSource` | MCP configuration source: `user`, `workspace`, `plugin`, `builtin`, `managed` or `account`. This does not identify a native tool implementation's origin. |
| `mcpTransport` | Recorded transport: `stdio`, `http`, `sse` or `memory`. This is configuration metadata, not evidence that a particular request occurred. |

Attribution requires a nonempty original MCP tool name and at least one supported server identity field. Identifier fields remain exact and are limited to 256 UTF-16 code units. Provider display names and model-facing tool names are limited to 180. Oversized, empty or malformed supplied provenance fields make the origin unknown; Trace never clips an identifier into a false match. Unrecognized configuration-source or transport values also remain unknown. Unrelated fields, including a tool title or an unverified `origin` field, cannot establish provenance.

Trace parses only complete retained evidence, within its existing 12,000-code-unit limit. It verifies the evidence's event ID, type, recorded time and source against the projected entry, then checks the raw and projected call ID and invocation tool name. Matching uses the exact source-agent and tool-call IDs within the attached session. Display names, model-facing name prefixes and chronological neighbors do not join calls.

A unique result may use its unique retained start's provenance. Conflicting starts or results, mismatched evidence, unknown source identity, truncated evidence and result-only calls remain unknown. When a start leaves the retained window, its result loses that attribution. Nothing is cached across snapshots, sessions or agents; current metadata never backfills a historical invocation by name.

## Host capability limits

The inspected `tools.getCurrentMetadata()` API reads currently initialized metadata. In a disposable local probe, repeated reads added no MCP requests or model requests. However, current inventory cannot establish which implementation supplied a past invocation. Trace makes no discovery RPC for the badge.

The probe also found that `getBuiltinDescriptors({})` returned native descriptors absent from the offered tool set. A custom tool registered as `powershell` with `overridesBuiltInTool: true` had no origin discriminator in current metadata, while the native `powershell` descriptor still existed. A matching name or absent MCP fields therefore cannot prove built-in or plugin origin. Those classifications remain unavailable until the host supplies stronger evidence.

Unsupported or failing discovery APIs do not affect timeline collection because the panel does not call them. Trace does not initialize tools, launch MCP servers, request inference, load other sessions or change permissions to populate a badge. Existing session and panel ownership checks remain in effect; see [Copilot integration](copilot-integration.md#tool-discovery).

## Validation and manual acceptance

The installed-runtime fixture explicitly configures two owned loopback MCP servers with the same original tool name and title. Session creation initializes these test servers. Opening Trace and reading current metadata add no MCP or model requests. Two explicit fixed local model responses invoke both tools, and the attached Trace snapshot retains each distinct server key and exact invocation identity. Native PowerShell events remain unknown. This establishes the MCP path on the inspected runtime; it does not test paid providers, account entitlement or native rendering.

Unit and DOM-boundary tests cover duplicate display names, renamed tools, per-event metadata changes, source/call collisions, independent sessions, malformed or oversized evidence and discovery failures. The renderer tests all four views, filtered failed results, exact evidence links, unchanged Statistics, literal Unicode and markup, live updates, retained focus and start eviction. The DOM double does not establish rendered geometry or native focus behavior.

Owner-performed UI acceptance was explicitly deferred for the November 20, 2026 overnight run. Pending checks are badge and details readability; duplicate provider identities; Unknown explanations; narrow and short panes; enlarged text; keyboard and screen-reader access; source navigation across views and filters; and focus and reading position during live updates and retention. The issue remains open until those checks are recorded. Automated verification, independent review, packaging and publication remain required.
