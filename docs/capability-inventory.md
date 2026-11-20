# Capabilities and observed use

Open **Statistics → Capabilities and observed use**, then choose **Refresh capability snapshot**. Trace compares a retrieved main-session catalog with retained tool invocations and skill loads. Merely opening the disclosure, polling events, or using the footer's timeline refresh does not read the catalog.

The two columns of meaning stay separate:

- **Available in retrieved tool snapshot** means the initialized tool metadata listed that exact model-facing identity at retrieval. A loaded-on-demand flag is shown when reported. It does not establish availability during an earlier turn or prove the tool was selected, authorized, executed, or successful.
- **Listed in skill catalog** reports the catalog identity, source, enabled flag and user-invocable flag. Model access remains unknown: the inspected catalog omits `disableModelInvocation`, even for a fixture skill configured with that flag.
- **Observed here** means a retained tool invocation boundary or skill load. Partial tool calls can have no retained start; their identity remains unknown. **Not observed here** applies only to the retained window; it never means unused, irrelevant, or unavailable earlier.
- **Not in current snapshot** describes an observed identity absent from a complete, valid retrieved catalog. It does not mean the earlier action was impossible or the capability is disabled now. The snapshot can predate a later observed action.
- **Inventory unknown** covers child-agent sources, malformed or conflicting identities, unavailable APIs, failed reads and incomplete comparisons. A main-session inventory is never applied to a child agent.

The panel shows the retrieval timestamp, retained-event count, omitted count, history state and observed timestamp range. It always warns that capabilities may have changed; after a minute or later recorded activity, it explicitly labels the snapshot stale. This is a refresh reminder, not a host freshness guarantee. The two RPC reads are not atomic, and the timestamp is when their results were retrieved, not when capabilities loaded. Supported events can be missing even when history retrieval succeeded. No snapshot is persisted or included in diagnostic exports.

## Supported host surface

Checked against installed SDK/runtime `1.0.106-8.unstable.r43566476370.g869eef3` in `generated/rpc.d.ts` (`CurrentToolMetadata`, `ToolsGetCurrentMetadataResult`, `Skill`, `SkillList` and session RPC declarations) and `generated/session-events.d.ts` (`SkillInvokedData`, `SkillSource`). Product code calls only:

| API | Supported interpretation |
| --- | --- |
| `session.rpc.tools.getCurrentMetadata()` | Currently initialized tool metadata. `tools: null` means uninitialized, not an empty inventory. `name` is the model-facing identity; metadata `mcpServerName` is the configured server key and `mcpToolName` is the raw MCP name. |
| `session.rpc.skills.list()` | The session's skill catalog. `name` is the unique identity; `declaredName` and command/display names are not join keys. `source`, `enabled` and `userInvocable` retain only supported values. Model invocability is unknown. |

Trace does not initialize tools, discover installed plugins, call MCP list/discovery methods, load/reload/enable skills, read skill paths, change permissions, start services or request inference for this view. In particular, `mcp.list()` may start servers and is unsuitable for this purpose. Built-in descriptors describe contracts, not the offered inventory or proof of native origin.

The installed-runtime fixture exercises the protected endpoint through the actual joined Trace extension. Two owned MCP servers expose the same raw tool name and title; they retain distinct configured keys and model-facing names. Two initialized SDK skills include one with model invocation disabled. Catalog refreshes before and after fixed local activity add no MCP requests, provider list/body reads, or model requests. Comparison marks both exact tool starts and the loaded skill observed, leaving the other skill unobserved and both skills' model access unknown. This fixture proves this installed pair, not every future SDK or account.

## Identity and limits

Tool matching requires complete matching retained event evidence and an unambiguous invocation. For MCP, the exact model-facing tool name, explicit recorded `mcpConfigServerName` and raw `mcpToolName` must agree with the catalog. Legacy event `mcpServerName` alone can be a display name and cannot establish this join. Non-MCP names can match exactly, while native built-in versus plugin origin remains unknown. A title, display name, missing MCP fields or a name resembling a built-in never establishes origin.

Skill matching uses the unique recorded name and agrees with a recorded source when present. A missing source is not filled in as historical provenance. A catalog's source describes that retrieved entry only. Duplicate catalog names, conflicting same-name provenance, clipped evidence and unusable identities remain unknown. An incomplete catalog cannot establish absence. Observation counts are bounded by retained events and never count a tool result twice when its unique retained start is paired.

The host projects at most 200 entries per catalog and identity strings of at most 256 UTF-16 code units. Overlong identities are rejected rather than shortened into join keys; omitted and invalid counts remain visible. Description, schema, body, path and URL fields are not copied; credentials are not requested and raw errors are discarded. The already-decoded host RPC result is outside Trace's transport-size control; Trace examines only bounded rows and allowlisted fields, without serializing or traversing raw metadata. Both the HTTP response and client stream are capped at 2 MiB. Comparison adds at most 300 retained observations. The keyboard-focusable list has bounded scrolling and wraps literal Unicode text.

## Endpoint and lifecycle

`GET <instance-capability-url>capabilities` accepts no session selector or request body. It requires the existing per-instance capability token, exact loopback Host, matching Origin when supplied and non-cross-site fetch metadata. `HEAD` performs no host reads. Closing the instance closes its collector; the bound session identity is checked before and after reads, and any unexpected response session ID must match it. The JSON schema is version 1 with `scope: "main-session"`, `capturedAt`, and separate `tools`/`skills` sections containing `status`, `items`, `omitted` and `invalid`.

Each section reports `ready`, `uninitialized` (tools only), `unsupported`, `unavailable`, `timeout`, `session-mismatch`, `closed` or `malformed`. Rejection, including a prohibited read without a supported typed discriminator, is `unavailable`; raw error text is discarded. Failure of either catalog does not stop timeline collection or silently turn an old catalog into a fresh success.

Concurrent reads share one operation. A five-second deadline bounds the wait. The SDK has no cancellation parameter for these reads, so a timed-out operation holds its slot until the underlying calls settle; repeated refreshes cannot accumulate unresolved RPCs. Instance close discards late results. The panel has a six-second request deadline, aborts superseded requests, ignores late results, and preserves its previous timestamped snapshot after a network failure with an explicit stale warning.

Native acceptance remains owner-performed: narrow and short panes, 150% text size, keyboard access to the disclosure/button/scrollable list, focus and reading-position preservation during activity, refresh failure, and closing/reopening the Statistics drawer. Automated DOM tests do not establish rendered geometry or native assistive-technology behavior.
