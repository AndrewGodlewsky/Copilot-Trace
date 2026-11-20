# Connected flow appearance

The owner supplied a reference image and requested a much clearer, more attractive vertical flow, retaining individual expansion. Apply this to the existing proof of concept; the event observer and recorded-evidence scope remain intact.

Use centered nodes joined by a thin line and downward arrow. Compact host nodes, wider message nodes and individually expanding detail panels preserve the reference's visual hierarchy without a pan/zoom diagram library. A conventional full-width list was the previous design; the connected flow better matches the explicit reference. Arrows mean chronological order, not causal dependencies.

The dark palette uses slate #171b23 / #222936, text #e9eef5, cyan #7dd3fc for models, green #a7e0b7 for tools, lavender #d4b5f6 for skills, and amber for host steps. Light mode uses the same category distinctions with darker accents on white. Use Segoe UI for compact labels and Consolas only for expanded evidence. Keep corners restrained, borders crisp and motion absent except a small disclosure rotation with reduced-motion support.

Collapsed nodes show a category icon/label, readable name or message excerpt, short recorded state and a disclosure chevron. Recorded model names and tool names appear when available; missing metadata stays generic. Move timestamps, agent IDs, event types and raw JSON into the expanded section. Expansion widens a node and turns off following. Retain node identity, focus and expansion while new events arrive. Each node remains a native details/summary control; color is accompanied by text/icon labels. Short and narrow panes wrap controls and evidence rather than overflowing.

Implementation: add bounded display fields to the existing projection and a pure presentation helper; update markup/styles and the asset allowlist; test display fallback/attribution and integration, synchronize 0.1.3, and obtain independent review of the complete uncommitted candidate. The live-installed checkout updates on a new Copilot session. Owner visual acceptance remains pending for the new appearance; prior positive feedback is not a test result for this candidate.

## Logo and hook grouping follow-up (0.1.4)

The owner requested a more distinctive SVG and correct native tab display, and suggested grouping consecutive hook activity. Use a compact connected-path mark in the manifest, panel header and favicon. The native tab resolves the owning plugin's manifest logo, not the canvas icon override; cached installation addresses the reference project's measured live-local metadata failure. Verify a managed local package using the CLI in a disposable profile before switching Trace's owner installation. Preserve unrelated plugins. Actual native tab rendering still requires the owner to check.

Group adjacent hook.start/hook.end events from the same agent into a Hooks disclosure. Each event retains its own inner disclosure and exact evidence. Count events, not inferred calls; start and completion may both be recorded. A non-hook event or agent change ends the group, preserving the visible sequence. Keep group and child expansion through append, history merge and retention; restore keyboard focus after required reparenting. Grouping model turns, merging tool lifecycles and deeper causal nesting are future work, because they require explicit correlation semantics beyond temporal adjacency.

## Naming and following (0.1.7)

The owner renamed the product to Trace. Use that name in the panel, native canvas/tab, logs, feedback template, skill and documentation. The private npm package and local development marketplace are named `trace`; the existing GitHub repository address remains the actual feedback/distribution destination.

When Follow live is checked, scroll the document to its full bottom, including footer controls and main padding. Do this on enable, successful polls (including unchanged responses), content-height changes and viewport resize. Opening evidence or a footer dialog still disables following. Observe the main content size so late assets, footer status and wrapping are covered without changing which events are retained. Disconnect the observer on page hide.

In 0.1.8, honor manual exploration: a retreat from the bottom unchecks Follow live, and later polls/resizes leave that position alone. Rechecking explicitly jumps to the bottom; returning there manually does not re-enable following. Compare actual page position on scroll and before any automatic movement so a queued scroll event cannot lose a race to polling. A two-pixel bottom tolerance accommodates fractional layout rounding. Disable browser scroll anchoring while following so layout anchoring is not mistaken for upward user movement; restore it automatically while paused. Verify manual scroll, queued-event races, resume, content growth, viewport resize and shrink clamping with deterministic fixtures; native input/scroll rendering remains an owner check.
