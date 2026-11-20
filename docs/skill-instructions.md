# Supplied skill instructions

Open a skill event to see **Supplied skill instructions** beside its existing explanation and recorded evidence. Trace shows the recorded name and trigger, a literal preview of up to 600 UTF-16 code units, and an **Exact retained instructions** disclosure for the complete retained body. The preview boundary preserves surrogate pairs; whitespace, Unicode, Markdown, code and HTML-looking text remain literal text. Both text regions support keyboard scrolling. Recorded invocation arguments, when available as a string, have a separate disclosure.

The installed SDK exposes these `skill.invoked` fields:

| Field | What Trace shows |
| --- | --- |
| `name` | The exact name from complete matching evidence. |
| `trigger: user-invoked` | The host attributes the load to an explicit user action. |
| `trigger: agent-invoked` | The host reports that the agent requested the skill. |
| `trigger: context-load` | The host reports loading it as part of another context, such as a custom agent configuration. This does not establish why it was selected. |
| Missing, empty or unrecognized `trigger` | An explicit unknown explanation; an unrecognized string remains visible literally. |
| `content` | The recorded instruction body. An empty string is labeled as recorded empty; absent or nonstring content is unavailable. |
| Optional `arguments` | Exact invocation inputs when recorded, separate from the reusable body. Trace does not reconstruct them from neighboring prompts. |

The installed-runtime fixture records the exact supplied Unicode, Markdown and HTML-looking body with `trigger: user-invoked`, `source: sdk` and an empty path. In that fixture, the host omits `arguments` even though the command invocation supplied inputs. Changing the fixture provider's current body after invocation does not change the historical event. See [Copilot integration](copilot-integration.md) for runtime scope and prerequisites.

## Evidence limits

Trace uses only the existing in-memory event evidence, bounded to 12,000 UTF-16 code units per event. Before showing instruction fields, it requires complete parseable evidence whose event ID, event type, source agent and timestamp match the projected row. The name and trigger must also agree with their bounded projected values. Missing or nonstring name/trigger values can agree with empty projected fields without supplying a name or attribution.

If evidence was shortened, malformed or mismatched, the instruction body is unavailable. This remains true if a content-looking fragment occurs before the clipping point: Trace does not repair clipped JSON or imply that fragment is the full body. The original bounded evidence remains inspectable. A shorter preview of a fully retained body is labeled separately from shortened event evidence.

Trace never reads a recorded skill path, rereads the current file, fetches a URL or invokes a skill to fill a historical gap. There is no new persistence, export or cross-chat access. A disposable-file test changes and then deletes the referenced file while the panel continues to use the original retained body; absent content stays absent.

## What loading establishes

A skill supplies instructions or context. It may refer to scripts, commands or tools, but loading does not show that those operations ran, that every instruction was followed, or which instruction caused a choice. The selection reason remains unknown when it is not recorded. Skill metadata such as `allowedTools` is not a recorded permission decision. Context loading is identified only by its recorded trigger, never by neighboring events.

The disclosure follows the same retained event through grouped, chronological, request-chapter and agent-lane views. Filters, navigation, expansion, focus and reading position use the existing event-row behavior. If the event leaves retention, its instruction text leaves with it.

## Validation limits

Automated tests cover known and unknown triggers, empty and absent bodies, separate arguments, Unicode boundaries, literal markup, clipped/malformed/mismatched evidence, changed source files, all four views, filters, history updates, focus, navigation and retention. The installed-runtime fixture uses disposable sessions and fixed local responses.

Native acceptance remains owner-performed: long-content scrolling, narrow/short panes, enlarged text, keyboard and screen-reader usability, and focus/reading position during live updates. The authorized deferral for the issue 14 run does not establish that these native checks passed.
