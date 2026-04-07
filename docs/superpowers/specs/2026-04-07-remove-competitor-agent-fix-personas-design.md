# Design: Remove Competitor Agent + Fix Hardcoded Personas

**Date:** 2026-04-07
**Branch:** fix/new-feature-flow
**Status:** Approved

---

## Problem

Two issues with the current AI agent pipeline:

1. **Competitor agent produces fabricated output.** The agent prompt instructs the model to "run web searches" but no browsing tool is wired up. The legacy (no-featureId) path explicitly says "no live web access". Every competitor analysis is either hallucinated or a generic market summary — it wastes tokens and misleads users.

2. **PRD personas are hardcoded.** `PRD_PRODUCT_CONTEXT` in `src/lib/agent-prompts.ts` hard-codes three actors (End users / Product Managers / Developers) that apply to Speqtr's own product, not to the feature being described. The result: every generated PRD writes user stories for "a product manager" regardless of whether the feature is a consumer checkout flow or an internal admin tool.

---

## Goals

- Remove the competitor agent entirely from the pipeline, API, UI, and type system.
- Fix persona generation so the PRD agent derives personas from the transcript (clarifying question answers + inference output) rather than a hardcoded list.
- Keep the pipeline linear: Clarifying Questions → Inference → PRD.

## Non-Goals

- Adding web search / browsing capability to any agent.
- Changing the clarifying questions prompt or the inference agent output format.
- Any PRD format changes beyond the persona derivation fix.
- Database migrations (no competitor artifacts in existing rows need to be cleaned up — they stay, just aren't written to anymore).

---

## Architecture

### Pipeline before
```
Clarifying Questions → Inference → Competitor (review gate) → PRD
```

### Pipeline after
```
Clarifying Questions → Inference → PRD
```

The "approve competitor to unlock PRD" gate in `WorkspaceDetailClient.tsx` is removed. Approving inference directly enables PRD generation.

---

## Changes by File

### Delete
- `src/app/api/agents/competitor/route.ts`

### `src/lib/agent-prompts.ts`
- Remove `COMPETITOR_OUTPUT_DISCIPLINE` export (the entire block, ~50 lines).
- Update `TRANSCRIPT_DISCIPLINE`: remove the "competitor research" example from the mention of prior pipeline steps.
- **Persona fix** — in `PRD_PRODUCT_CONTEXT`, remove the hardcoded `### Actors/Users Involved` block:
  ```
  - End users (consumers of the shipped product)
  - Product Managers (owners of the spec and roadmap)
  - Developers (implementers; flag technical dependencies that affect their work)
  ```
  Replace with a single instruction:
  > Derive the relevant user personas from the feature's clarifying question answers and the inference output present in the transcript. Name each persona by their role and observable behavior — not their job title alone.

### `src/lib/context.ts`
- Remove `COMPETITOR_OUTPUT_DISCIPLINE` import.
- Narrow `agentKind` type: `'inference' | 'competitor' | 'prd'` → `'inference' | 'prd'`.
- Remove `buildCompetitorSystem` function.
- In `includeMessageForAgent`: remove `competitor` branch; update the PRD branch (`t === 'inference' || t === 'competitor' || t === null`) to drop `t === 'competitor'`.
- Remove `else if (agentKind === 'competitor')` dispatch in `assembleFeatureContext`.

### `src/lib/artifact-persistence.ts`
- Remove `ARTIFACT_KIND_COMPETITOR` constant and its named export.
- Remove it from `AGENT_ARTIFACT_KINDS` Set.
- Remove its `defaultTitleForAgentArtifactKind` branch.
- Update the JSDoc comment on `appendCompletedAgentArtifact` to drop competitor mention.

### `src/lib/ai/recordUsage.ts`
- Remove `'competitor'` from the `source` union type.

### `src/app/api/features/[id]/discuss/route.ts`
- Remove `ARTIFACT_KIND_COMPETITOR` import.
- Remove the `getLatestCompletedArtifactByKind` call for competitor (currently in a `Promise.all` with inference).
- Remove `competitorArtifact`, `competitorBlock`, and the `competitorBlock` variable injected into the system prompt.
- Update the system prompt description that lists "competitor analysis" as an injected artifact.

### `src/app/(main)/workspaces/[id]/WorkspaceDetailClient.tsx`
- Remove `COMPETITOR_CHAT_STUB` constant.
- Remove `competitorDocument` state (`useState<string>("")`) and `setCompetitorDocument`.
- Remove `isLikelyFullCompetitorBody` helper function.
- Remove `streamCompetitorToDocument` function.
- Narrow `DocumentPanelKind` type: `"inference" | "competitor" | "prd"` → `"inference" | "prd"`.
- Remove `"competitor"` from `resolveRevisionAgent` return type and its body logic.
- Remove all competitor branches in the document content resolver, agent dispatch, pipeline gate, and message processing loops.
- Remove the competitor gate: inference approval must directly expose the PRD generation option without requiring a competitor step first.

### `src/components/ChatInterface.tsx`
- Remove `"competitor"` from the `agentType` prop union.
- Remove competitor label (`"Competitor Agent"`), inline "View competitor analysis" button, and post-message competitor action button.
- Update `onViewAgentDocument` callback type: `"inference" | "competitor"` → `"inference"`.

### `src/app/(main)/artifacts/page.tsx`
- Remove `'competitor'` case from the kind → label switch.
- Update the empty-state copy to remove competitor mention.

---

## Persona Derivation — How It Works

The clarifying questions agent (`infer-questions`) generates feature-specific questions including a persona/audience question (type: `single` or `multiple`). User answers are stored in `feature.inference_clarifications` and already injected into the feature block in `assembleFeatureContext` under `### User clarifications (structured)`.

The inference agent output (which includes "for whom" in the Problem Framing section) is also in the transcript passed to the PRD agent.

By removing the hardcoded actors and adding the derivation instruction, the PRD agent will read both of these signals and produce contextually correct personas. No new data flow is needed — the information is already there.

---

## Error Handling

No new error handling needed. Removal of dead code paths reduces surface area. Existing competitor artifacts in the database are unaffected (no migration required — `feature_artifacts` rows with `kind = 'competitor'` remain but are never written to again).

---

## Testing

- Manually run the pipeline end-to-end on a feature: confirm inference → PRD works without a competitor step.
- Confirm PRD output uses feature-specific personas, not "Product Manager / Developer / End user".
- Confirm the artifacts page doesn't show a "Competitors" filter tab.
- Confirm the discuss chat doesn't reference competitor artifacts.
- TypeScript compilation (`tsc --noEmit`) should pass with no `competitor` type references remaining.
