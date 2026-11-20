# Plugin foundation implementation plan

> Execute inline using the executing-plans workflow; the existing workspace is already isolated.

**Goal:** Transfer reusable Copilot knowledge and deliver a minimal runnable Trace shell.
**Architecture:** Host SDK registration, per-instance canvas lifecycle, read-only loopback server, static panel.
**Tech stack:** Node.js >=22, ES modules, Node test runner; no dependencies.
**Spec:** [Foundation design](../specs/2026-11-19-plugin-foundation-design.md).

## Tasks

- [x] Add `test/shell.test.mjs` for HTTP authorization, asset confinement, repeated opens, session ownership, pending close and failed startup; confirm failure before implementation.
- [x] Implement `com.github.copilot/extensions/trace/{extension,canvas,server}.mjs` and `web/`. `traceCanvas({createCanvas,getSession})` returns `{canvas,close}`; `startServer()` returns `{url,close}`.
- [x] Add manifests, launch skill, logo, release notes and dependency-free package metadata at version 0.1.0.
- [x] Adapt check/install/package scripts and create a disposable installed-runtime fixture proving registration, open, reopen, close and zero inference.
- [x] Write concise `AGENTS.md`, a Claude pointer, integration/workflow docs and a transfer ledger. Preserve source provenance and distinguish optional future capabilities from implemented ones.
- [x] Run unit tests, metadata/syntax checks, package validation and installed-runtime fixture. Review final candidate; report manual checks separately.

## Review focus

Tests must cover wrong Host/token, path traversal, foreign sessions, simultaneous open/close and startup rejection. Installation must use the CLI, packaging must carry all runtime assets, and no Explorer identity may remain in active manifests or code. Source checkout stays unchanged. No publication is part of this setup.

## Setup evidence

Four unit tests passed; syntax/manifest/release checks and package validation passed. The installed-runtime fixture passed registration, ownership, open/reopen/close and zero inference with the SDK-adjacent `copilot.exe`; the lower-level runtime lacked an extension launch provider, as recorded in the integration guide. An independent read-only reviewer found no blocking issues and reran unit/check commands successfully. Relative documentation links and anchors resolved. The source working tree remained clean. Native rendering, slash-command discovery and profile installation were not tested.
