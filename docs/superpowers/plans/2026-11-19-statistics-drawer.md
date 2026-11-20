# Statistics footer drawer

The owner selected option A from the interactive statistics prototypes: a persistent bottom control opens an upward overlay drawer. The header-overlay and separate Overview-tab alternatives were not selected. Keep the existing Trace styling and recorded statistics; remove the disclosure above the timeline.

Implementation plan:

1. Move statistics into a bottom-aligned native dialog using the existing footer dialog controller. Keep Close/Escape, focus return and pause-on-inspection behavior.
2. Place Statistics and a retained turn/tool count above the utilities in a fixed bottom bar. Measure the bar to reserve document space, including when text size or wrapping changes; preserve whole-page Follow live and manual scrolling.
3. Constrain the drawer to the pane, allow its contents to scroll, keep its Close button reachable, and preserve the timeline behind the modal backdrop. Maintain narrow/short pane and enlarged-text usability.
4. Synchronize version 0.1.10 and release notes, run existing checks, obtain independent review, package and install the preview under the existing authorization. Actual owner UI acceptance remains a separate publication gate.

Reference: chat artifact `trace-statistics-options-6b42.html`, option A (sample data). The approved choice concerns placement and interaction, not the illustrative counts. The production implementation continues to use the current session snapshot and its retained-history limits.
