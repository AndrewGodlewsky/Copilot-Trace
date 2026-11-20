# Instruction sources and recorded loads

Open **Statistics → Instruction sources and recorded loads** to inspect two separate kinds of evidence. **Refresh instruction sources** retrieves the current main-session source list through the host. **Recorded skill loads** uses retained `skill.invoked` events and works even when the source API is unsupported or empty. A skill event's **Inspect instruction sources** button opens its exact historical occurrence in this view.

| Evidence | What it establishes | What remains unknown |
| --- | --- | --- |
| Current host-reported source capture | The bounded source record returned by `session.rpc.instructions.getSources()` at the displayed retrieval time. | Whether its body appeared in any historical prompt, its load time, current enablement, compliance and selection reasons. |
| Retained skill load | The recorded occurrence, source agent, time and instruction body available from complete matching event evidence. | The complete prompt, instruction hierarchy, referenced-script execution and compliance. |
| Discovery/index record | The host reported a `nested-agents` or `child-instructions` record. | Whether the referenced instruction bodies were loaded. An index is not those bodies. |
| Empty, unavailable or partial evidence | The source API's state or the bounded evidence that remains. | Absence of instruction context. A source list can omit instructions actually supplied to a model. |

## Inspecting a source capture

Current records are grouped by the host's reported location and type. Each opens its captured literal body and reported source ID/reference. The reference is not necessarily a filesystem path: the inspected runtime uses `nested AGENTS.md` as an index label. Trace does not open references, follow links, match globs or scan directories.

Only a reported `applyTo` array supplies declared applicability patterns. A missing, empty or malformed array leaves scope unknown; omission does not mean globally applicable. Patterns describe possible applicability, not evidence that a historical turn included the body. `defaultDisabled: true` means the source starts disabled. Neither true, false nor omission establishes its current enabled state. Unknown type/location fields remain unknown. Duplicate IDs and incomplete identities are marked ambiguous; omissions prevent a claim of unambiguous catalog identity.

The SDK describes the list as sources in merge order. Trace preserves reported order within the groups but does not infer a complete hierarchy, universal precedence, conflict resolution or instruction compliance. Different and conflicting rule text can be inspected without choosing which rule prevailed.

Refreshing the source list does not rewrite the body already open in the inspector. The inspector labels an earlier capture, and choosing a current source explicitly opens the newer capture. Retrieval time is never relabeled as historical load time. Missing, empty and clipped bodies have different explanations.

## Inspecting recorded skill loads

Loads group only when the exact retained source-agent ID, skill name, recorded path and catalog source are usable and match. Every occurrence retains its own timestamp and body, including repeated loads with different instruction text. Incomplete identities remain separate. Names and paths never join these groups to current host records.

Bodies reuse [skill instruction evidence](skill-instructions.md), including its complete matching event checks. Trace never backfills missing historical text from the current catalog or a file. The original-event button uses the same [guarded retained-example identity](glossary.md) as the glossary: event ID, type, source agent, timestamp, evidence and truncation state must still match. If evidence changes or leaves retention, the inspected body stays fixed and the original-event link becomes unavailable. Choosing another occurrence is explicit. Original navigation pauses Follow live, closes Statistics and opens the exact retained event.

The list reconciles existing controls rather than replacing them on every event poll. Open group disclosures, focused controls and reading position remain stable where their evidence survives. If a focused row leaves retention, focus moves to the surviving list. All instruction text is rendered literally with `textContent`; markup and URLs are not interpreted.

## Read and lifecycle boundaries

Source reads happen only on the explicit refresh control. Opening this view, inspecting a skill, polling events, refreshing capabilities and requesting diagnostics do not read instruction sources. Trace calls only `session.rpc.instructions.getSources()` on its joined current session. It does not call `reload`, sessionless discovery, model operations, skill providers or independent filesystem reads to obtain bodies. The host API itself may reread its known source files.

The reader checks session ownership before and after the asynchronous operation. Requests share one pending slot. A five-second timeout returns a distinct state but retains that slot until the host operation actually settles; it does not imply the RPC was cancelled. Close invalidates pending results. Unsupported, unavailable, malformed, session-mismatch and timeout results do not stop normal event observation.

The projection examines at most 100 source rows. IDs are exact nonempty strings of at most 256 UTF-16 code units; invalid IDs are rejected rather than shortened. Labels use 256 units, source references 2,048, and applicability arrays at most 32 patterns of 512 units each. Invalid metadata becomes unknown. Bodies preserve exact text up to 12,000 UTF-16 code units, clipping without splitting a surrogate pair. Only bounded allowlisted fields are serialized. A 500 KiB aggregate serialized-item budget omits further records that do not fit; the response reports omitted records, invalid/ambiguous records and clipped bodies. Counts describe this bounded projection, not all instructions supplied to the model.

The `instruction-sources` route is read-only GET/HEAD under the existing capability path, loopback Host, exact supplied Origin, Fetch-Site and restrictive CSP boundaries. HEAD makes no host call. Both the route and streaming browser reader enforce a 2 MiB transport ceiling. Browser refreshes abort superseded requests and reject late or closed results. The source body never enters plugin diagnostics, persistence or exports.

## Validation and limits

Unit and DOM boundary tests cover multiple source scopes, conflicting and repeated skill bodies, unknown and malformed fields, duplicate IDs, missing/empty/clipped content, Unicode and aggregate bounds, protected routes, explicit-only reads, timeout coalescing, ownership changes, close, refresh races, literal text, focus preservation and expired original links.

The installed-runtime fixture extends its existing fifth disposable session with only two owned instruction files and an in-memory organization instruction. The fixed model request includes the global file and organization text but omits the scoped file's distinctive body. `getSources()` reports both files and omits the organization instruction. Changing the owned global file after the turn changes its current source response without another model call, while the retained skill load keeps its historical body. These checks use fourteen fixed local responses across six owned sessions, with no paid inference or existing user sessions.

Historical file-load timestamps, a complete prompt/hierarchy and child-agent current source catalogs remain unsupported. Native acceptance is deferred for the owner-authorized issue 20 run, not passed: source-state interpretation, current versus historical text, empty/unsupported and skills-only states, narrow/short panes, 150% text, keyboard/focus, disclosures, live updates and eviction still need owner checks. DOM tests and the runtime fixture do not establish native geometry or screen-reader usability.
