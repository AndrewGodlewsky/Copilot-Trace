# Observed time and reported usage

Open **Statistics → Observed time and reported usage** to capture the displayed retained window. The disclosure stays frozen while live events arrive. Close and reopen it to capture a new window. Filters do not change its scope. Playback, replay practice and synthetic demonstrations use only their displayed prefix; future events and separately captured live activity are excluded.

The capture is memory-only, with at most 300 retained events. Original-record buttons navigate to the exact source evidence. If an original changes, becomes ambiguous or leaves the displayed window, its link becomes unavailable; frozen calculations do not silently change. Changing Learning contexts or stepping backward clears the disclosure. Opening it pauses Follow and automatic playback.

## Timing

Supported operation intervals are tool `execution_start`/`execution_complete` pairs and delegated-agent `started`/`completed` or `failed` pairs. Each pair needs exactly one start and one end for the same exact source and tool-call ID, unique event IDs, complete matching raw evidence, consistent boundary metadata and valid ordered timestamps. Blank IDs, invalid sources, conflicting tool/MCP metadata and unsupported `origin` or `overridesBuiltInTool` markers prevent pairing. A delegated-agent interval also requires an explicit agent identity. Model turns, hooks, permissions and other activity are not timed by this view.

| Measure | Meaning | Original contributors |
| --- | --- | --- |
| Wall span | Earliest through latest valid matching retained timestamp | The two window boundary records, or one record when both are the same |
| Summed operation intervals | Sum of every valid paired elapsed interval | Every listed start and end |
| Union-covered time | Duration covered by at least one listed interval; overlaps count once | The same listed pairs |
| Unaccounted time and gaps | Complement of covered intervals inside the timestamp window | Window boundaries and the listed pairs |

These are observed timestamp measures, not compute, idle, private thinking or productive time. A parent task and its delegated child can overlap; the sum may exceed the wall span. The view does not add reported `durationMs` or API `duration` to boundary intervals. It does not use the current clock to invent the end of an incomplete operation.

The timestamp parser requires a valid calendar date and an explicit timezone. Missing, malformed, reversed or ambiguous boundaries are listed as excluded. Equal valid boundary timestamps give a measured zero. No valid pair leaves the sum, coverage and gaps unavailable. Unsafe aggregate arithmetic also gives an unavailable measure. The timestamp window can include untimed event types, and its exclusions are shown separately. It does not establish the duration of the entire chat or request.

## Usage

Trace retains host `assistant.usage` callbacks in its existing bounded event window. The inspected installed SDK declares these events ephemeral, and the disposable installed-runtime fixture confirms that reopening an observer does not recover earlier usage from history. Only retained entries marked as live observations are eligible; absence is unavailable, not zero.

Each accepted receipt carries the following interpreted fields from complete matching evidence:

| Field | Rule |
| --- | --- |
| `accounting.sourceSessionId` | Exact accounting source; distinct from the envelope `agentId` |
| `accounting.sequence` | Nonnegative safe integer scoped to that accounting source |
| `accounting.usageId` | Exact per-source receipt identity |
| Envelope `agentId` | Main chat when absent, otherwise the exact delegated-agent identity |
| `model` | Exact bounded nonblank model ID matching the projected value |
| `provider` | Optional exact `{id, kind, label}` reference; inspected kinds are `copilot` and `loki` |
| `modelProvider` | Optional provider-family label, never an exact endpoint identity |
| Token fields | Optional nonnegative safe integer counts; missing values remain unavailable |

Trace groups receipts only when accounting source, envelope agent, model, provider family and the complete exact provider reference match. Without an exact provider reference, each unique receipt remains a separate group. A shared family such as `other` does not establish the same provider. The runtime extra `providerType` is not declared by the inspected usage schema and is not used for attribution.

Deduplication checks both source-plus-sequence and source-plus-usage-ID across all retained receipts. Identical interpreted receipts count once even if event ID, timestamp or unrelated metadata differs. Contradictory identities or interpreted values exclude the entire connected conflict group, including transitive conflicts. Equal counts on distinct identities are separate receipts. An invalid consumed field cannot silently overwrite a valid value. Unrelated host metadata remains uninterpreted and does not alone invalidate a receipt; clipped raw evidence cannot support aggregation.

Input, output, cache read, cache write and reasoning are separate reported token measures. Each group states the number of receipts reporting or omitting each measure. A partial sum is labeled partial; a wholly missing measure or an unsafe sum is unavailable. Reasoning is part of output, so a receipt reporting reasoning greater than output is inconsistent and excluded when both values are present. Cache relationships are provider-specific: Trace neither adds cache to input nor universally subtracts it. The fixed OpenAI-compatible fixture's cache-read count is a subset of its input; that observation is not a universal provider contract.

No combined token, credit, billing or monetary total is displayed. An unavailable credit status with `cost: 0` does not establish free usage; SDK `cost` is an experimental multiplier, not currency. Session metrics, model/provider/agent summaries, checkpoint or shutdown watermarks and `subagent.totalTokens` overlap the selected receipt stream and are not added. No metrics RPC, paid inference, transcript export or persistence is introduced.

## Evidence and limits

The implementation was checked against installed SDK/runtime `1.0.106-8.unstable.r43566476370.g869eef3`, including `AssistantUsageData`, `UsageAccountingIdentity`, `ModelProviderRef` and checkpoint semantics. The checked-in [runtime fixture](../scripts/e2e.mjs) uses disposable sessions and a local fixed-response provider. Its overlapping delegation case verifies four exact owner/joined receipts: main input/output/cache-read 200/40/80, each of two children 100/20/40. The fixture knows those fixed inputs and checks their combined 400/80/160 without claiming a combined provider total in the UI. It also verifies distinct accounting and agent IDs, normal live receipt continuity, boundary intervals and no historical usage after reopening. See [Copilot integration](copilot-integration.md).

Pure and DOM tests cover malformed and missing data, exact-source pairing, concurrency, duplicate/conflicting receipts, safe arithmetic, partial measures, retention, literal text, guarded links, frozen updates and Learning isolation. Those checks do not establish native desktop rendering, comprehension or live model quality. Native narrow/short panes, enlarged text, keyboard/focus, units/scope clarity and live reading remain owner acceptance checks under the authorized deferral for this iteration.
