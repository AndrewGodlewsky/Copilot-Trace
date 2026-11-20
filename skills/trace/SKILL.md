---
name: trace
description: Open the installed Copilot Trace canvas in the GitHub Copilot desktop app when the user invokes /trace or asks to open Copilot Trace.
---

# Copilot Trace

Discover the installed `trace` canvas in the canvas catalog and open it with `open_canvas`, empty input, and a new instance ID. Reuse an existing instance only when the user is returning to that panel. Use the provider identity from the catalog.

This version is a starter screen. It has no agent-callable product actions and performs no tracing, inference, project reads, or persistence. Describe that boundary accurately; let the user define the plugin's behavior before implementing it.

If the canvas is unavailable, explain that it needs a Copilot desktop app with canvas support and the enabled Trace plugin. Suggest starting a new session after installation. Report the actual open result; do not claim success when it fails.
