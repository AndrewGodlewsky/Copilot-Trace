# Trace

Current version: **0.1.35**

A GitHub Copilot desktop plugin for understanding the activity inside your current chat. `/trace` opens a live timeline with turn markers and expandable recorded evidence. This is an initial proof of concept: explanations describe what events mean; they do not infer why the model made a decision.

The setup adapts reusable engineering practices from Copilot Explore. See [what was transferred](docs/context-transfer.md), [agent instructions](AGENTS.md), [host integration](docs/copilot-integration.md), and [development workflow](docs/development-workflow.md).

Every completed iteration now includes a patch version bump, release notes, independent review, recorded verification, packaging, and a verified push to `main`. Tags, GitHub Releases and installation into your Copilot profile are separate actions.

## Use Trace

Open `/trace` beside a chat, then continue chatting. Available history appears first and new events arrive about once per second. Compact, color-coded nodes form a vertical flow; connecting arrows show event order only. Collapsed nodes show message excerpts, recorded model/tool names and short states. Timestamps, event types and evidence stay inside the expandable details. Consecutive hook events from the same agent share a **Hooks** section: expand it for invocation summaries and the original boundaries in recorded order. Pipeline counts are separate from event counts; one invocation can include multiple callbacks or no configured handler. Open an event to inspect its recorded inputs, results and identifiers. Opening a step or scrolling upward away from the bottom turns off **Follow live**, so incoming events do not pull you away. Checking it again jumps to the bottom of the entire plugin, including the footer, and resumes following. Scrolling back down manually does not re-enable it.

Open **Statistics** in the persistent bottom bar for model turns, hook pipelines, tool calls and skill loads, plus hook and skill names. The bar shows a small retained turn/tool count while you scroll. Statistics opens upward as an overlay drawer; Close or Escape returns focus to its button. Opening it pauses Follow live. Counts cover retained events only, pair boundaries by agent and recorded ID, and include invocations with only one boundary available. Events without usable IDs are reported separately. These are not whole-chat totals.

A **Model turn** heading marks one iteration of the agent loop. Activity recorded for the same agent before its matching end is indented, followed by a compact **Turn complete** marker. One user request may involve many turns. Missing boundaries stay explicit, tools can run outside turns, and interleaved agents keep their chronological order. Expand either boundary for the original evidence; indentation shows timing, not causal ownership.

The panel supports user messages, model turn boundaries, assistant messages/intent/reported reasoning, tool starts/results, skill invocations, subagents, hooks, permissions, compaction and host diagnostics when the host supplies them. Skill triggers distinguish user invocation, agent invocation and context loading; an absent trigger stays unknown. Tool results use agent identity and tool-call IDs to find retained starts. Chronological neighbors are not treated as causes.

Tool cards include **Observed action stages and category limits** with links to the original assistant request, permission records, invocation and result when their IDs and ownership can be matched. Invocation entry and approval do not prove that an operation executed; missing permission evidence stays unknown. See [action stages](docs/action-stages.md) for live/history differences and supported fallbacks.

Tool provenance shows recorded MCP provider details when the invocation supplies them. An absent or unverified origin stays **Unknown**, including built-in or plugin tools without a reliable origin field. Provider labels do not establish network activity or trust. See [tool provenance](docs/tool-provenance.md) for the metadata basis and limitations.

Tool cards classify recognized requested operations as **Read**, **Search**, **Edit**, **Execute** or **External access**. Unrecognized or incomplete evidence stays **Unclassified**. Categories describe the request, including when it fails or is denied; they do not prove effects. Shell commands remain opaque execution with unknown possible effects. See [operation categories](docs/operation-categories.md) for supported contracts and fallbacks.

Hook summaries explain when a documented hook type runs and distinguish reported outcomes from missing or conflicting boundaries. Only explicitly recorded output supports a context or decision description; timing does not explain why the assistant selected an operation. See [hook lifecycles](docs/hook-lifecycles.md) for grouping, counts and evidence limits.

Skill details preview the instructions supplied in the recorded load event, with the exact retained text available to expand. The recorded trigger distinguishes user invocation, agent invocation and context loading; unavailable or shortened evidence stays explicit. Loading instructions does not prove that referenced scripts ran or that every instruction was followed. Trace does not read the current skill file to replace historical content. See [skill instructions](docs/skill-instructions.md).

Statistics also offers an optional capability comparison. Refresh its snapshot to compare the current main-session tool and skill catalog with retained observed use. The capture time and scope remain visible: not observed here does not mean unused, and today's catalog cannot establish past or child-agent availability. Skill model-invocation availability remains unknown when the host omits it. Refreshing reads existing metadata only. See [capability inventory](docs/capability-inventory.md).

The optional instruction-source view separates current host-reported sources and declared scopes from historical skill loads. Refresh requests a source snapshot from the current main session; its text may reflect files changed after a turn, and listed sources are not proof their bodies reached the model. Recorded skill loads keep their original text and evidence links. Missing load times, scope and instruction hierarchy stay unknown. See [instruction sources](docs/instruction-sources.md).

The optional **Retrieval ledger** in Statistics lists recognized recorded reads, searches and web retrieval attempts. It separates requested targets and ranges from successful returned text, failed attempts and missing results, with links to original evidence. Repeated operations and distinct recorded references have separate counts; references are not a count of physical files. Returned information does not prove understanding, use or continued presence in active context. See [retrieval ledger](docs/retrieval-ledger.md).

Partial-evidence labels distinguish requested ranges and excerpts, explicit host-shortened output previews, Trace's own evidence clipping and the retained-history window. Available limits keep their recorded units; unknown coverage stays unknown. Trace does not read a current file or a host output file to fill gaps. See [partial evidence](docs/partial-evidence.md).

Contextual scope help explains incomplete history, omitted events, shortened evidence and unmatched boundaries near the affected counts and summaries. A disconnected feed keeps its last retained data visibly stale until reconnection; changing views does not change that status. No observed event is not proof that nothing happened. See [evidence scope](docs/evidence-scope.md).

Open **Glossary** from the footer or a term button in an event's details for explanations of model turns, tools, hooks, skills, context, subagents, permissions and compaction. Start with a short definition, expand for more detail, and inspect a retained event example when available. Static teaching examples and expired evidence are labeled explicitly. The glossary shares its vocabulary with event explanations and does not control the agent. See [glossary](docs/glossary.md).

The glossary also compares instruction and skill guidance, configured hook automation and permission controls. Recorded examples distinguish a hook's explicit decision request from a permission outcome; missing output stays unknown. General explanations describe what each mechanism can do without claiming that a rule was enforced or the task is correct. See [guidance and controls](docs/guidance-and-controls.md).

Compaction details explain recorded attempts and show a retained summary when the host supplies one. Before/after context-token estimates appear only with a supported accounting basis and comparable measurements. Missing boundaries, clipped summaries and unknown outcomes stay explicit; reported compaction success does not prove that meaning was preserved or reveal what the model remembers. See [compaction](docs/compaction.md).

Subagent handoff details connect the recorded delegated task, child activity and returned parent-tool result through explicit identities. Same-name and nested agents stay distinct, with original evidence links and literal bounded text. Missing links and results stay unknown; a separate context does not establish which parent instructions or files reached the child. See [delegation handoffs](docs/delegation-handoffs.md).

Failed-operation details can show later related-attempt suggestions with a disclosed matching rule. Original arguments, results and permission outcomes remain separately inspectable; a suggestion does not establish that an operation was a retry or that a failure was recovered. Missing results and partial retained history stay explicit. See [recovery attempts](docs/recovery-attempts.md).

Recognized assistant check-result statements offer optional comparison with retained validation results. Candidates remain unlinked until you explicitly associate one; a user-linked result does not verify the statement. The exact command, available output and typed process exit stay separate from tool-reported success. Missing evidence is not proof that no check ran. See [claims and recorded results](docs/claim-evidence.md).

Trace keeps up to 300 recent supported events per panel in memory, with up to 12,000 UTF-16 code units of evidence per event; omissions and shortening are labeled. Token deltas, canvas bookkeeping and replay checkpoint copies are excluded. Encrypted/opaque reasoning fields are omitted. Closing the panel releases its observer and server. Trace makes no model requests and saves no transcripts. Instruction refresh requests bounded source content from the host; Trace does not scan project paths. The host may retain its own logs; event payloads and source snapshots can contain sensitive instruction text, chat content, file paths and tool arguments.

## Footer controls

The footer opens Versions, Settings and Logs as centered overlay dialogs, with a dimmed backdrop and Close/Escape dismissal. Closing returns focus to the originating footer button. It includes:

- **Version:** expand the installed version and browse the short explanation for every release.
- **Refresh:** immediately check the latest observer snapshot while keeping expanded steps open. Automatic polling continues. This does not reconstruct history that the host could not provide.
- **Settings:** adjust all panel text from 100% to 150%. The setting lasts for this open panel.
- **Show logs:** inspect, copy or download a text file of plugin diagnostics. Each server/panel keeps its latest 200 structured log entries in memory, with omitted-entry counts. Logs include connection/history status and plugin failures, never chat evidence, tool arguments, IDs, paths, URLs, credentials or raw exception text. A disconnected server uses an explicitly dated cached snapshot if available. Clipboard/download restrictions have selectable-text fallbacks. Startup failures before the panel is available are outside these logs.
- **Feedback:** open a new GitHub issue form for this repository. Nothing is submitted automatically; paste diagnostic logs if useful.

## Develop

Use Node.js 22 or later. There are no npm dependencies and no build step. Copilot supplies the runtime SDK.

```powershell
npm test
npm run check
npm run package
```

Packaging creates a validated, self-contained plugin directory under ignored `dist/`. It does not publish or install anything.

For repository development, start an issue brief with `npm run iteration -- start <id>`. Record the independent review, then use `npm run verify:iteration -- <id>` and `npm run iteration -- status <id>` before publication. For visible changes, first record the owner's actual UI acceptance with `npm run iteration -- ui <id> <report-file>`. Reports live under ignored `.iteration/`. See the [workflow](docs/development-workflow.md) for the complete sequence and optional measured usage ledger. These Git-based evidence commands run in the development checkout; a packaged plugin does not carry its Git history or private receipts.

## Install a cached preview

For the native tab logo, prefer a managed cached installation. Some desktop versions omit tab-icon metadata for live local marketplaces. Package the plugin, then install the printed package directory with the installed Copilot CLI:

```powershell
npm run package
& $env:COPILOT_CLI_PATH plugin install 'C:\path\to\validated\package'
```

When replacing an existing live Trace installation, first uninstall the registered Trace plugin and remove its local marketplace through the CLI, using the names shown by the CLI inventory. Retain the checkout. Restart Copilot and open `/trace` in a new session; confirm the logo on the native tab as well as in the panel header. A cached installation is a snapshot: package and install each new version, and retain its source package directory for updates.

## Install for live development

Requires a Copilot desktop app with canvas support. From the checkout you intend to keep:

```powershell
# If copilot is not on PATH, first set COPILOT_CLI_PATH to its installed executable.
npm run install:copilot
```

This registers the current directory as the `trace` marketplace, installs `trace@trace`, and lists plugins through the Copilot CLI. Start a **new desktop session**, then use `/trace`. If skill discovery has not refreshed, ask Copilot to open the installed Trace canvas.

Keep the checkout in place: local marketplace installs load it live. In particular, do not install from a temporary worktree you plan to remove. Installation/enablement and successful rendering are separate checks. No profile installation is performed merely by running the tests.

## Verify against the installed host

Set these to an inspected, matching pair already installed by Copilot:

```powershell
$env:COPILOT_SDK_DIR = 'C:\path\to\installed\copilot-sdk'
$env:COPILOT_CLI_PATH = 'C:\path\to\installed\copilot.exe'
npm run e2e
```

For the installation inspected during setup, use `copilot.exe` beside the `copilot-sdk` directory. The lower-level `copilot-runtime.exe` failed extension startup with "No extension launch provider is registered". See [runtime selection](docs/copilot-integration.md#runtime-and-plugin-layout).

The fixture checks native SDK registration, plugin ownership, actual session history and live event delivery, opening/reopening/closing and local assets. That phase requires zero model requests. It then sends three synthetic inputs to a loopback provider with fixed local responses, checking actual delivery and interaction fields against Trace's projections. A second disposable session allows only the task tool and two configured agents with no tools; four additional fixed responses verify distinct agent identities, parent invocation links and recorded overlap. Two further disposable sessions allow only PowerShell and use three fixed responses to verify denied/approved writes to owned temporary files, action-stage links, pending-permission uncertainty and permission request differences between live delivery and history. A fifth session uses two owned loopback MCP fixtures and two fixed responses to verify distinct provider identities despite identical tool titles; metadata reads and opening Trace add no server calls or inference. All phases use a disposable Copilot home, no paid inference and no existing chat. The fixture does not operate a browser or install into your profile. Unit fixtures cover additional event and attribution cases; fixed responses do not establish real model quality or autonomous tool/skill choices.

The same fifth session also registers three fixture hook types. Five callbacks produce nine recorded pipeline invocations and eighteen original boundaries; the fixture verifies exact projection, counts, batched input and exposed versus absent output. These callbacks are test-owned; Trace remains an observer.

That session explicitly loads an SDK-provided fixture skill before sending its returned prompt. The fixture checks exact Unicode and literal markup, the recorded user trigger, omitted optional arguments and the original body after the fixture source changes. Trace reads no skill body itself. This shares the same twelve fixed responses across five sessions; it does not establish autonomous skill selection or instruction compliance.

Manual acceptance after installation:

1. In a new desktop session, send a chat message, then open `/trace`. Confirm earlier activity appears.
2. Continue with a request that normally uses a tool. Confirm new turn/tool events appear without reopening Trace. If the host invokes a skill, inspect its recorded trigger; absent events are not proof that no skill was used.
3. Expand evidence while new events arrive. Confirm it stays open, text is readable, and Follow live stops scrolling. Re-enable Follow live and confirm the scrollbar reaches the page bottom, including the footer, as activity arrives and the pane resizes. Scroll upward with mouse/trackpad, keyboard or scrollbar: Follow live should uncheck and incoming activity should leave you where you are. Check it again to resume. Use Tab and Enter/Space to open/close a step with visible focus.
4. Resize to a narrow and short pane and check light/dark modes: no horizontal page overflow, clipped controls or unreadable evidence. Evidence may scroll within its own box.
5. Close/reopen Trace, confirm it reconnects, and check the native tab identifies Trace.
6. At the bottom, expand release notes, refresh with a step open, and try every text size in a narrow pane. Check keyboard focus and close/Escape behavior. Show logs, copy them and export a text file; confirm the diagnostic report contains no chat content. Open Feedback and confirm it targets this repository without submitting.

Automated HTTP/SDK tests do not establish visual rendering or slash-command discovery. Owner acceptance remains required by the repository workflow before publication.

## Future work

AI interpretations, cross-session browsing, exports, saved traces and deeper causal analysis are deferred. The [integration guide](docs/copilot-integration.md) preserves the constraints for adding those systems. The [first-version design](docs/superpowers/specs/2026-11-19-live-evidence-design.md) records this proof of concept's scope.
