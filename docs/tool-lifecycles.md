# Tool lifecycle cards

The default **Grouped tool calls** view puts retained `tool.execution_start` and `tool.execution_complete` events in one expandable card when their source-agent and tool-call IDs match exactly. It does not join by proximity, tool name or turn membership. Main chat is the collector’s explicit empty-string source; a child agent has its own nonempty string. Missing or invalid projected sources, non-string IDs and IDs longer than 256 UTF-16 code units cannot pair. Call IDs must also be nonempty. The collector projects an omitted raw agent ID as main chat; explicit invalid raw source values remain unavailable.

Each card keeps every original boundary as a separate expandable evidence row, with its recorded timestamp, source and original event data. The original tool name and arguments remain in that evidence. Existing limits still apply: up to 300 supported events and 12,000 characters per evidence record, with shortened evidence labeled. Rendering is literal text, including Unicode and HTML-like strings. No new host API, model call or stored transcript is involved.

## Ordering and navigation

A grouped card occupies the position of its **first retained boundary**. Later matching boundaries appear inside it; other cards stay ordered by their own first boundary. This deliberately reduces repeated cards, so flattened grouped contents are not the complete event sequence. Consecutive hook groups still stop at any intervening event, including a tool completion moved into an earlier card.

Select **Chronological events** to show every original retained event separately in the collector’s order. Each tool card also provides a **Start in event order** or **Result in event order** button for every retained boundary. A button switches views, opens the original event and moves focus to its disclosure. It uses the retained node directly, without embedding arbitrary event IDs in selectors or URLs.

The collector orders by parseable recorded timestamps, preserves history/arrival order for equal timestamps, and puts missing or unparseable timestamps last. This is the available recorded sequence, not proof of actual wall-clock order or causality. Turn context is computed before grouping. Individual tool boundaries retain their own turn context; a whole lifecycle card does not assert that all its events occurred within one turn.

## Partial, conflicting and timed calls

- A single retained start says **Completion not observed**, never “running.” A single result reports its own observed outcome and says **Start unavailable**. The missing boundary might be absent from history or outside retention.
- `success: false` means **Failed**, `success: true` means **Completed**, and an absent/invalid success flag means **Result recorded**. These describe the host’s report, not independent verification of side effects.
- Multiple distinct starts or multiple distinct completions under one exact identity produce **Conflicting boundaries · Outcome unknown · Elapsed unknown**. All evidence stays available; Trace does not choose a winner or infer which boundaries pair. Duplicate delivery of the same event ID is already deduplicated by the collector.
- Elapsed time is shown only for exactly one start and one completion with usable matching identities and valid timezone-qualified ISO timestamps. Calendar-invalid dates, malformed values, missing timezone, reversed timestamps and unavailable boundaries give **Elapsed unknown**. Equal timestamps yield zero. Supported fractional seconds have one to three digits. This interval is not model thinking time, CPU time or billable usage.
- Statistics counts distinct usable source/call identities across retained boundaries, including partial and conflicting cards. Invalid identities are excluded and reported as unlinked events. The connection count is retained **events**, not the number of cards. Changing the view changes neither count.

Cards are reused by exact identity and evidence rows by event ID. Adding a result, receiving overlapping history or evicting a retained start preserves the surviving card and row expansion. Mode changes retain those nodes and pause Follow live. Focus is restored after node moves; if focused evidence ages out while its card survives, focus falls back to the card summary. Evidence that is no longer retained is removed, and an evicted start’s title or timing is not preserved as if its evidence were still available.

## Verification

Pure presentation and disposable collector tests cover interleaving, two agents sharing a call ID, invalid identities, conflicts, completion-first history, duplicate delivery, timestamp limits and retention eviction. A small DOM boundary double executes the real renderer to check node reuse, expansion, navigation and focus-restoration calls. It does not establish browser or native desktop geometry or focus behavior.

Native owner checks remain pending under the authorized deferral for this run: expanded-card continuity through live completion/history/retention updates; both views and boundary navigation using the keyboard; source labels and partial/conflicting states without relying on color; narrow/short panes and enlarged text; light/dark themes; Follow live and reading-position behavior. No browser or desktop UI automation was performed.
