# Guidance and controls

Open **Glossary → Compare guidance and controls** for an optional comparison of instructions/skills, configured hooks and permissions. The existing **Learn about…** controls on skill, hook and permission events open the same glossary and prefer that event as an example. The comparison begins collapsed and adds no top-level panel.

The authored lesson explains which mechanism to use: instructions for broad conventions, skills for reusable task guidance, hooks for configured code at supported lifecycle moments, and permissions for authorization. None guarantees compliance or task correctness. Loading a skill does not establish that its guidance was followed or that a referenced script executed. Script execution needs separate evidence. These explanations live beside the shared definitions in `web/glossary.mjs`.

## Recorded examples

`guidanceComparison` in `web/presentation.mjs` selects one retained example for each mechanism. It uses the contextual event when applicable, otherwise the latest appropriate retained event in collector order. Missing examples use the explicit label **Static example — not from this chat**. The three examples are independent; the comparison establishes no causal chain between them.

| Example | Interpretation reused | Limits shown |
| --- | --- | --- |
| Skill | `skillInstructions` | Literal name and bounded instruction preview from complete matching evidence; shortened, empty or unavailable bodies stay explicit. The original event retains the exact available body. |
| Hook | `hookInvocations` | Exact source/invocation association, reported pipeline outcome, documented timing, typed output and incomplete/conflicting evidence. |
| Permission | `explainStep` | Recorded approved, denied or cancelled kinds; unavailable/unrecognized outcomes and missing decision sources remain qualified. Approval does not prove execution or effects. |

For hooks, only validated `reported` fields receive interpreted labels. A typed `preToolUse.permissionDecision` of `allow`, `deny` or `ask` is a **recorded permission decision request**. It does not itself establish the applied permission decision. Supplied `additionalContext` is text, not approval or enforcement. Descriptions mentioning denial, inputs and pipeline success never become decisions. Missing output does not prove that nothing happened. Unsupported types retain literal output with unknown timing and no invented decision interpretation. The optional output disclosure keeps raw JSON distinct from the lesson.

A pipeline can contain zero or multiple configured callbacks. Its presence and success do not establish which handler ran or whether a rule took effect. Trace reads no hook policy, configuration, script or current instruction file for this lesson. It changes no collector counts, inventories or host behavior, and adds no requests, inference or persistence.

## Reading and original evidence

Selection freezes the lesson, body and original-event identity until the user selects a concept again or reopens Glossary. Hook examples also freeze all supporting pipeline boundaries. Live updates and view/filter changes preserve the selected nodes, disclosures, focus, panel scroll and paused Follow state. Missing, changed or ambiguous supporting evidence makes its link unavailable without replacing the frozen text. Reappearing IDs do not revive expired links.

Original buttons revalidate with `retainedExample` and use the shared `showBoundary` navigator: switch to chronological events, reset the filter, expand the exact evidence and focus its event. An unavailable example leaves the modal and reading position unchanged. Dismissal uses the glossary's existing focus-return behavior. Content and Unicode render through text nodes; the comparison never follows a recorded path or URL.

## Contract and sources

The conceptual comparison follows GitHub's maintained [comparison of customization features](https://docs.github.com/en/copilot/concepts/customizations/comparing-customizations), checked November 20, 2026. Its guidance/skills/hooks distinction describes supported customization mechanisms, not proof of a particular session's behavior. Support differs by Copilot surface.

The maintained [SDK hook guide](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/hooks), checked the same day, distinguishes registered SDK callbacks from repository filesystem hooks and describes optional structured output. For the installed contract, inspected SDK `1.0.106-8.unstable.r43566476370.g869eef3` declarations supply `PreToolUseHookOutput`, `PostToolUseHookOutput` and `PostToolUseFailureHookOutput` in `types.d.ts`, plus `HookStartData`, `HookEndData` and `PermissionCompletedData` in `generated/session-events.d.ts`. Successful post-tool and failure-only hooks are distinct; descriptions for another Copilot surface must not replace this contract.

The existing [hook fixture evidence](hook-lifecycles.md) records five callback executions across nine pipeline invocations. Pre-tool output was absent despite supplied context; successful post-tool output included context. [Action-stage evidence](action-stages.md) documents permission routing and ownership limits. These disposable local observations constrain interpretation; the comparison adds no host integration and does not rerun a live model.

Unit and DOM-boundary tests cover typed decisions versus prose, context-only and missing output, unsupported types, partial/conflicting/malformed evidence, permission outcomes, static fallbacks, literal long Unicode and stable selection/navigation across views, filters, updates and eviction. Native comparison clarity, narrow/short panes, 150% text, keyboard/focus/disclosures and live reading remain pending under the owner's issue-21 UI deferral. Automated DOM tests establish neither rendered geometry nor native acceptance.
