---
name: trace
description: Open the installed Trace canvas in the GitHub Copilot desktop app when the user invokes /trace or asks to open Trace.
---

# Trace

Discover the installed `trace` canvas in the canvas catalog and open it with `open_canvas`, empty input, and a new instance ID. Reuse an existing instance only when the user is returning to that panel. Use the provider identity from the catalog.

Trace displays available history and live events from the current chat. Users can expand steps to inspect readable fields and exact retained JSON. Opening Trace makes no model call. Only a user's Investigate click inside a failed event starts a separate tool-free helper with the displayed bounded evidence; model and reasoning preferences are in Settings. Trace adds no transcript archive or project-file access and has no agent-callable product actions. Keep the chat running normally; do not generate extra tool calls or prompts just to populate the timeline.

Describe missing reasons honestly: recorded skill triggers can identify user invocation, agent invocation or context loading, but they do not establish which instruction caused the choice. The panel is a bounded view of supported host events, not a complete trace of internal decisions.

If the canvas is unavailable, explain that it needs a Copilot desktop app with canvas support and the enabled Trace plugin. Suggest starting a new session after installation. Report the actual open result; do not claim success when it fails.
