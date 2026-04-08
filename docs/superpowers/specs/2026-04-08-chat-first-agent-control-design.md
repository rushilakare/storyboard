# Chat-First Agent Control + Meaningful Artifact Titles

**Date:** 2026-04-08
**Status:** Approved

---

## Overview

Three improvements to the Speqtr agent pipeline UX:

1. **Stop generation** — any streaming response (inference, PRD, discussion chat) can be interrupted mid-stream via a stop button that replaces the send button during generation. Partial content is preserved.
2. **Meaningful artifact titles** — artifact titles are LLM-generated from feature context rather than hardcoded strings like "Feature inference" or "PRD".
3. **LLM intent classification** — discussion chat messages are classified by `gpt-4o-mini` before dispatch; recognized agent commands (regenerate inference, generate PRD, etc.) show an inline confirmation nudge before triggering the appropriate agent.

---

## Section 1: Stop Generation

### Behavior
- While any streaming is active (inference, PRD, or discussion chat), the send button in `ChatInterface` renders as a **stop icon**.
- Clicking stop aborts the in-flight fetch. Whatever content has already streamed remains in the UI.
- A `"Response interrupted"` label is appended to the partial message in the chat thread.
- This applies uniformly — no distinction between artifact generation and chat replies.

### Implementation

**`WorkspaceDetailClient.tsx`**
- Add `const abortControllerRef = useRef<AbortController | null>(null)`.
- Before every `fetch()` call (inference, PRD, discussion), create a new `AbortController`, store in `abortControllerRef.current`, and pass `signal` to `fetch()`.
- In each `finally` block, set `abortControllerRef.current = null`.
- Pass `onStop={() => abortControllerRef.current?.abort()}` down to `ChatInterface`.

**`consumeInferenceStream` / `consumePrdStream`**
- Accept an optional `AbortSignal` parameter.
- Check `signal?.aborted` at the top of each `while` loop iteration; if true, call `reader.cancel()` and break.
- On early exit, mark the current streaming message with a `"Response interrupted"` suffix in its content and status `"needs_review"`.

**`ChatInterface.tsx`**
- Accept `onStop?: () => void` prop.
- When `isLoading === true`, render stop icon button instead of send button; clicking calls `onStop()`.

---

## Section 2: Meaningful Artifact Titles

### Behavior
- Inference artifact title example: `"Smart Notification Grouping Inference"`
- PRD artifact title example: `"Offline Mode PRD — Mobile"`
- Titles are 4-8 words, generated from feature name + purpose.
- Fallback to `"Feature inference"` / `"PRD"` if generation fails.

### Implementation

**`/api/agents/infer/route.ts`** and **`/api/agents/prd/route.ts`**
- Fire a **parallel** `generateText()` call using `gpt-4o-mini` alongside the main `streamText()` call.
- Title prompt: `"Generate a concise 4-8 word title for this [inference/PRD] artifact based on the feature: [name] — [purpose]. Return only the title, no punctuation."`
- Await the title promise alongside the stream setup (both start simultaneously).
- Return the generated title as an `X-Artifact-Title` response header.

**`WorkspaceDetailClient.tsx`**
- After each agent `fetch()`, read `res.headers.get("X-Artifact-Title")` before entering the stream consumer.
- Pass the title to `appendCompletedAgentArtifact()` (inference) and `upsertPrdArtifact()` (PRD).
- No DB schema changes needed — `feature_artifacts.title` column already exists.

**`FeatureArtifactsPanel.tsx`**
- No changes needed — already uses `title` field if present, falls back to kind label.

---

## Section 3: LLM Intent Classification

### Behavior
- Every message sent in discussion chat is classified before dispatch.
- If the intent is a known agent command, an inline confirmation nudge appears in the chat thread:
  > "Looks like you want to regenerate the inference. Proceed?" [Yes] [No, send as message]
- If confirmed, the appropriate agent function is called and an acknowledgment bubble appears.
- If declined, the message is sent as a normal discussion message.
- If intent is `"discussion"`, the message goes directly to `/discuss` — no extra user interaction.
- If classification fails (network/timeout), fallback is to treat as discussion.

### Recognized intents
| Intent | Example phrases |
|--------|----------------|
| `regenerate_inference` | "redo the inference", "redo the analysis", "regenerate inference" |
| `generate_prd` | "create the PRD", "generate PRD", "write the PRD", "make the PRD" |
| `regenerate_prd` | "redo the PRD", "regenerate PRD", "rewrite the PRD" |
| `discussion` | everything else |

### Implementation

**New route: `POST /api/features/[id]/classify`**
- Request body: `{ message: string, featureState: { hasInference: boolean, hasPrd: boolean } }`
- Uses `generateObject()` with `gpt-4o-mini` and schema:
  ```ts
  { intent: z.enum(["discussion", "regenerate_inference", "generate_prd", "regenerate_prd"]) }
  ```
- System prompt includes current feature state so the model understands which agents have already run (e.g., can't generate PRD if inference hasn't happened yet).
- Returns JSON, no streaming.

**`WorkspaceDetailClient.tsx`**
- In `handleSend()` (discussion submit handler), call `/classify` first.
- On `intent === "discussion"`: proceed to `/discuss` as normal.
- On command intent: set a `pendingCommand` state with the intent + original message text; render confirmation nudge.
- On confirmation: call the appropriate handler (`runInitialInference()`, `handleApprove()`, `handlePrdRecoveryRegenerate()`); clear `pendingCommand`.
- On decline: send the original message to `/discuss` as a regular message.

**`ChatInterface.tsx`**
- Accept `pendingCommand?: { intent: string; message: string }` and `onCommandConfirm / onCommandDecline` props.
- Render the inline confirmation nudge as a distinct message bubble when `pendingCommand` is set.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/app/api/agents/infer/route.ts` | Parallel title `generateText()`, return `X-Artifact-Title` header |
| `src/app/api/agents/prd/route.ts` | Same |
| `src/app/api/features/[id]/classify/route.ts` | New route — LLM intent classification |
| `src/app/(main)/workspaces/[id]/WorkspaceDetailClient.tsx` | AbortController ref; read title header; classify before discuss; pending command state |
| `src/components/ChatInterface.tsx` | Stop button; `onStop` prop; pending command nudge UI |

---

## Verification

1. Start inference → stop mid-stream → verify partial content stays, "Response interrupted" label appears, send button returns
2. Same for PRD generation and discussion chat reply
3. Create a feature → run inference → check `feature_artifacts.title` in DB is a meaningful string, not "Feature inference"
4. Same for PRD artifact title
5. In discussion chat, type "regenerate the inference" → verify confirmation nudge appears → confirm → inference re-runs
6. Type "generate the PRD now" → nudge appears → confirm → PRD generates
7. Type ambiguous text ("I think this needs more work") → no nudge, goes straight to discussion
8. Simulate classify endpoint failure → message treated as discussion, no error shown to user
