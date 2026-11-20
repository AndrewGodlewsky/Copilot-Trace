# Trace foundation

Prepare this repository for a different Copilot desktop plugin, using the reusable engineering lessons from Copilot Explore. The user selected a minimal runnable shell in addition to instructions and technical context.

## Approach

An instructions-only transfer would leave host integration untested. A fork would import unrelated product assumptions. Use a small native canvas shell plus curated reference documents. Plain Node.js ES modules follow the source repo; the installed host supplies the SDK. No npm dependencies are needed.

The shell registers `trace`, opens a static welcome panel through `/trace`, and closes its loopback server with its canvas instance. It performs no inference, project reads or persistence. Product behavior remains undecided. Installation is provided as an explicit CLI command; this setup does not install into the user's profile or publish a release.

## Acceptance

- Adapt agent instructions, SDK/session guidance, development and release practices, and record what was excluded with source provenance.
- Ship Trace manifests, launch skill, SVG, extension and local web assets with matching initial version `0.1.0`.
- Protect the read-only server with loopback binding, exact Host, an instance capability token, an asset allowlist and restrictive browser headers.
- Repeated opens share an instance; different instances are isolated. Reject foreign sessions and close pending servers safely.
- Provide test, check, package, install and installed-runtime smoke commands. The smoke test uses a disposable home and a local rejecting provider, with zero inference.
- Respect the owner's prohibition on UI automation; native appearance and slash-command discovery remain manual checks.
