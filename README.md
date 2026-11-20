# Copilot Trace

Current version: **0.1.1**

A minimal GitHub Copilot desktop plugin foundation. `/trace` opens a native canvas with a welcome screen. The plugin's actual behavior is still to be defined; this shell performs no tracing, inference, project reads or persistence.

The setup adapts reusable engineering practices from Copilot Explore. See [what was transferred](docs/context-transfer.md), [agent instructions](AGENTS.md), [host integration](docs/copilot-integration.md), and [development workflow](docs/development-workflow.md).

Every completed iteration now includes a patch version bump, release notes, independent review, recorded verification, packaging, and a verified push to `main`. Tags, GitHub Releases and installation into your Copilot profile are separate actions.

## Develop

Use Node.js 22 or later. There are no npm dependencies and no build step. Copilot supplies the runtime SDK.

```powershell
npm test
npm run check
npm run package
```

Packaging creates a validated, self-contained plugin directory under ignored `dist/`. It does not publish or install anything.

For repository development, start an issue brief with `npm run iteration -- start <id>`. Record the independent review, then use `npm run verify:iteration -- <id>` and `npm run iteration -- status <id>` before publication. For visible changes, first record the owner's actual UI acceptance with `npm run iteration -- ui <id> <report-file>`. Reports live under ignored `.iteration/`. See the [workflow](docs/development-workflow.md) for the complete sequence and optional measured usage ledger. These Git-based evidence commands run in the development checkout; a packaged plugin does not carry its Git history or private receipts.

## Install locally

Requires a Copilot desktop app with canvas support. From the checkout you intend to keep:

```powershell
# If copilot is not on PATH, first set COPILOT_CLI_PATH to its installed executable.
npm run install:copilot
```

This registers the current directory as the `copilot-trace` marketplace, installs `trace@copilot-trace`, and lists plugins through the Copilot CLI. Start a **new desktop session**, then use `/trace`. If skill discovery has not refreshed, ask Copilot to open the installed Trace canvas.

Keep the checkout in place: local marketplace installs load it live. In particular, do not install from a temporary worktree you plan to remove. Installation/enablement and successful rendering are separate checks. No profile installation is performed merely by running the tests.

## Verify against the installed host

Set these to an inspected, matching pair already installed by Copilot:

```powershell
$env:COPILOT_SDK_DIR = 'C:\path\to\installed\copilot-sdk'
$env:COPILOT_CLI_PATH = 'C:\path\to\installed\copilot.exe'
npm run e2e
```

For the installation inspected during setup, use `copilot.exe` beside the `copilot-sdk` directory. The lower-level `copilot-runtime.exe` failed extension startup with "No extension launch provider is registered". See [runtime selection](docs/copilot-integration.md#runtime-and-plugin-layout).

The fixture checks native SDK registration, plugin ownership, opening/reopening/closing and local assets. It uses a disposable Copilot home and an anonymous loopback provider that rejects inference; zero model requests are required. It does not operate a browser, install into your profile or use an existing chat.

Manual acceptance after installation: confirm `/trace` opens the panel, the text fits a narrow and short pane in light/dark modes, closing and reopening works, and the native tab identifies Trace. Automated HTTP/SDK tests do not establish visual rendering or slash-command discovery.

## Where to start building

Define the first user workflow, the information Trace needs, and whether it needs the attached chat, an isolated helper, or no model at all. Then add that behavior to the existing canvas boundary. The [integration guide](docs/copilot-integration.md) keeps the optional persistence, helper, privacy and runtime lessons available without adding those systems prematurely.
