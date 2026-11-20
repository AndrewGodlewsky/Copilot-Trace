# Context transferred from Copilot Explore

Inspected `A:\Claude\Copilot-Explore` on November 19, 2026 at commit `e591ce8b4cee3ffcbc316ec3b6aa658a485b8580` (Explorer `0.1.109`). The source working tree was clean and was used read-only. Trace initially contained only its name in README. The owner requested reusable context and then selected a minimal runnable shell. A follow-up explicitly widened the transfer to include standing release/publication instructions and other reusable development requirements.

## Included and adapted

| Source material | Destination and decision |
| --- | --- |
| `AGENTS.md` | Trace instructions: host-owned SDK, ownership, local HTTP, data safety, tests, installation, mandatory independent review and the complete version/commit/push-to-main workflow. Product-specific rules excluded. |
| `docs/copilot-integration.md`, `docs/research-sdk-tools.md` | [Integration guide](copilot-integration.md): host layout, attached versus owned sessions, helper isolation, tools, accounting, diagnostics and installation lessons. Helpers remain reference guidance only. |
| `docs/development-workflow.md`, `scripts/iteration.mjs`, `test/iteration.test.mjs` | [Workflow](development-workflow.md): issue briefs, independent review, candidate-bound verification, resumable evidence, lock protection and explicit measured usage ledger. Imported tooling and regression tests; adapted the UI gate to record owner acceptance instead of launching Explorer's browser suite. |
| `extension.mjs`, `canvas.mjs`, `server.mjs` under the Explorer extension | New small Trace implementation follows registration, per-instance lifecycle and protected local-assets patterns. No Explorer imports or runtime dependency on that checkout. |
| Root/extension manifests, marketplace, launch skill and SVG convention | New Trace identity, `/trace`, version 0.1.0 and original placeholder icon/screen. No Explorer logo, prompts or version history. |
| `scripts/install.mjs`, `package.mjs`, `check.mjs`, `release-metadata.mjs`, `e2e.mjs` | Adapted CLI installation, allowlisted package, metadata checks and disposable installed-runtime fixture. Only Trace shell behavior is exercised. |
| Storage/project-context, diagnostics and voice investigations | General privacy, filesystem, uncertainty and native-runtime pitfalls extracted into the integration guide. Feature implementations excluded. |
| `.gitignore` | Dependencies, packages and local evidence remain ignored; local environment files are also excluded. |

The source integration handoff itself carried lessons from the owner's Enhance Prompt and Usage Insights repositories. Those are historical provenance, not dependencies or instructions governing Trace. This transfer inspected Explorer and the locally installed SDK, not a fresh audit of both predecessor repositories.

## Excluded deliberately

- Explorer's question maps, nodes, answers, branches, research prompts, decisions, ADR workflows, review queues, sharing rules, product roadmaps, prototypes and historical plans.
- Its controller/model/storage implementation, helper operation enums, voice adapter, UI code and feature-specific tests. These couple tightly to Explorer's data and behavior; importing them would imply a product design the owner has not supplied.
- Background inference, project reads, persistence, telemetry and usage collection as executable features. Their reusable constraints are documented for later decisions.
- Explorer branding, IDs, environment variables, data roots, release history, installed records and credentials. Trace has a new independent identity and no existing data migration.
- Explorer's browser-layout test scenarios and historical ten-issue cost experiment/model targets. Trace uses owner-reported UI acceptance; the general comparison/measurement discipline is retained without claiming Explorer's savings apply here.
- Git tags and GitHub Releases remain separate from the now-authorized routine commit/push-to-main workflow. Copilot profile installation remains a separate requested action.
- Live UI automation and paid inference. The owner restricts UI automation; visible acceptance stays manual.

## Follow-up audit and restored requirements

The initial transfer retained release metadata consistency but deliberately excluded standing publication authorization and weakened independent review to a recommendation. The owner clarified that these were intended to transfer. Trace now requires every completed iteration, including documentation changes, to bump at least one patch version, add release notes, obtain independent review, pass applicable checks, package, commit, safely integrate into `main`, push and verify the remote commit.

| Other source requirement | Audit result |
| --- | --- |
| Issue brief with observable acceptance and UI/host classification | Restored the actual `iteration start` command and required brief. |
| Independent reviewer for each iteration | Restored as mandatory, with explicit authorization for a separate review agent and a recorded report tied to the candidate. |
| Fresh verification receipts and interruption recovery | Restored `verify:iteration` and `iteration status`; edits, missing logs and changed evidence invalidate readiness. Preserve an active verifier's lock and report failures. |
| Explicit usage ledger | Restored import/validation and per-model fresh/cached accounting. Counts remain optional when unavailable; no private-session scraping or invented billing. |
| Bounded coordination and workflow evaluation | Restored sequential roadmap work, one implementer per file set, consolidated feedback, measured routing trials and dated regression observations. Historical savings targets excluded. |
| Native UI verification | Adapted to `iteration ui` with actual owner acceptance bound to candidate/brief. No fabricated approval and no automatic browser launch. |
| Formatting-template input boundary | Added the general structure-only rule to the integration guide; no ADR implementation imported. |
| SDK, session ownership, privacy, persistence, installation and model accounting | Already present in agent instructions/integration guidance; rechecked against source. Feature-specific contracts remain reference material, not active Trace behavior. |

The source repository has a root `AGENTS.md` and no other nested agent-instruction files. Its launch/research skills encode Explorer product behavior and remain excluded. The original foundation design/plan describe the first setup phase; this follow-up supersedes their publication scope, not their product boundary. The new workflow applies to future work and is used for this release. The starter canvas is unchanged by this follow-up; its earlier native appearance and slash-command acceptance remain pending and are not represented as passing UI evidence.

## Evidence and future use

The owner later authorized the bounded failure investigation in Trace 0.1.53. On November 20, `owned-helper.mjs`, `research-model.mjs`, `research-model-settings.mjs` and `research-usage.mjs` were inspected read-only in Explorer at [revision 9cfb056b60ea54e027101af2d7f3d69376a4dd3c](https://github.com/AndrewGodlewsky/Copilot-Explore/tree/9cfb056b60ea54e027101af2d7f3d69376a4dd3c). The clean checkout supplied host pairing, account/model, isolation, atomic preference and accounting lessons. Trace implements its own smaller explicit-click, tool-free failure helper and private namespace; Explorer's research framework, prompts, UI, project/web access and broader assistance remain excluded. This exception supersedes the initial “reference guidance only” status for that one operation, not the broader product exclusions. See [failure investigation](failure-investigation.md).

The shell uses the installed SDK's `createCanvas`/`joinSession` contract. Its test scripts are the current verification mechanism; this document does not imply future test runs pass. The short [design](superpowers/specs/2026-11-19-plugin-foundation-design.md) and [plan](superpowers/plans/2026-11-19-plugin-foundation.md) record setup scope.

For a future feature, start from these distilled docs, then inspect a specific source module only if it is relevant. Revalidate experimental APIs against the installed host. The exact source revision is available in the [Explorer snapshot](https://github.com/AndrewGodlewsky/Copilot-Explore/tree/e591ce8b4cee3ffcbc316ec3b6aa658a485b8580); its [instructions](https://github.com/AndrewGodlewsky/Copilot-Explore/blob/e591ce8b4cee3ffcbc316ec3b6aa658a485b8580/AGENTS.md) and [integration handoff](https://github.com/AndrewGodlewsky/Copilot-Explore/blob/e591ce8b4cee3ffcbc316ec3b6aa658a485b8580/docs/copilot-integration.md) preserve the original context. Trace's runtime never reads that repository.
