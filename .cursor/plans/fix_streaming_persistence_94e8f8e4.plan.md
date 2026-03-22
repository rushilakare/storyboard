---
name: Fix streaming persistence
overview: Add mid-stream persistence so that PRD content (and all agent streaming content) is durably saved during generation, not just after completion. Also add guards against accidental page unloads and server-side fallback persistence.
todos:
  - id: debounced-save
    content: Add debounced mid-stream PUT to prd_documents during the streaming read loop (both handleApprove PRD path and handleSend PRD path)
    status: pending
  - id: beforeunload
    content: Add beforeunload handler with sendBeacon fallback to persist partial content when user navigates away during stream
    status: pending
  - id: server-onfinish
    content: Add onFinish callback in /api/agents/prd/route.ts to persist completed PRD + message from server side as fallback
    status: pending
  - id: generating-status
    content: Add 'generating' feature status, set it before PRD stream starts, detect on hydration
    status: pending
  - id: recovery-banner
    content: Build recovery banner component with 3 options (Continue from draft / Regenerate / Edit manually) shown when status is 'generating'
    status: pending
  - id: continue-endpoint
    content: Add 'continue' mode to /api/agents/prd that accepts partial content and instructs LLM to continue from where it left off
    status: pending
  - id: res-ok-check
    content: Add res.ok checks before consuming stream body across all agent fetch calls in WorkspaceDetailClient
    status: pending
  - id: revision-prd-save
    content: In handleSend PRD revision path, also PUT to /api/features/{id}/prd after stream completes (currently only persists message)
    status: pending
  - id: memory-entry
    content: Append MEMORY.md entry documenting all changes
    status: pending
isProject: false
---

# Fix Streaming Persistence -- Stop Losing Mid-Stream Content

## Problem

All agent streaming content (PRD, inference, competitor) lives **only in React state** until the stream completes. The DB writes (`persistMessage` + `PUT /api/features/{id}/prd`) execute only after the read loop at [lines 587-601 of WorkspaceDetailClient.tsx](src/app/workspaces/[id]/WorkspaceDetailClient.tsx). Any interruption (reload, timeout, crash, network drop) loses everything.

## Changes

### 1. Add debounced mid-stream saves for PRD content

**File:** [src/app/workspaces/[id]/WorkspaceDetailClient.tsx](src/app/workspaces/[id]/WorkspaceDetailClient.tsx)

During the PRD streaming loop (lines 568-573 and 428-440), add a debounced `PUT /api/features/{id}/prd` that fires every ~3 seconds or every ~2000 characters (whichever comes first). This ensures partial content reaches the DB even if the stream is interrupted.

- Track `lastSaveTime` and `lastSaveLength` variables inside the streaming loop
- After each chunk, check if enough time/content has elapsed and fire a non-blocking `PUT`
- Extract the save logic into a `savePrdDraft` helper to avoid duplication between `handleApprove` and `handleSend`

### 2. Add `beforeunload` handler during streaming

**File:** [src/app/workspaces/[id]/WorkspaceDetailClient.tsx](src/app/workspaces/[id]/WorkspaceDetailClient.tsx)

Add a `useEffect` that registers a `beforeunload` event listener when `streamingRef.current` is true (or use a dedicated `isStreaming` state). This shows the browser's native "are you sure you want to leave?" dialog.

Additionally, in the `beforeunload` handler, fire a synchronous `navigator.sendBeacon` to persist the latest accumulated content as a last-ditch save.

### 3. Server-side `onFinish` fallback persistence

**File:** [src/app/api/agents/prd/route.ts](src/app/api/agents/prd/route.ts)

Use the Vercel AI SDK `onFinish` callback in `streamText()` to persist the completed PRD content server-side. This acts as a safety net -- even if the client disconnects before its post-stream persistence runs, the server will still save.

```typescript
const { textStream } = streamText({
  model: openai("gpt-5.4-2026-03-05"),
  system: context.systemPrompt,
  messages: context.messages,
  onFinish: async ({ text }) => {
    // Server-side fallback: upsert PRD + persist message
  },
});
```

This requires importing `supabase` in the route and duplicating the upsert logic, but it guarantees the completed output is always saved regardless of client state.

### 4. Add `generating` feature status + recovery banner with 3 options

**Schema:** [supabase/schema.sql](supabase/schema.sql) -- update the status check constraint to include `'generating'`

**Client flow:**

- **Before PRD stream starts:** PATCH feature status to `generating`
- **After stream completes:** PATCH to `done` (existing behavior)
- **On hydration (page load with `?feature=`):** if loaded feature has `status === 'generating'`, fetch whatever exists in `prd_documents` and show a **recovery banner** instead of starting the normal chat flow

**Recovery banner (new component `PrdRecoveryBanner`):**

Displayed at the top of the PRD editor panel when `status === 'generating'` on load. Shows partial draft (if any) in the editor and presents three actions:

- **"Continue generating"** -- Sends `POST /api/agents/prd` with a new `continue` field containing the partial content. The server prepends the partial draft to the system prompt with instructions like "The following PRD was partially generated before being interrupted. Continue writing from exactly where it left off. Do not repeat content already written." Client appends new chunks to the existing `prdDocument` (not replacing it).
- **"Regenerate from scratch"** -- Sends a normal `POST /api/agents/prd` (same as initial generation). Clears the editor and streams fresh content. Replaces the `prd_documents` row.
- **"Edit draft manually"** -- Dismisses the banner, sets status to `review` via PATCH, and lets the user edit the partial draft in the editor and click "Save Changes."

### 5. `/api/agents/prd` -- support `continue` mode

**File:** [src/app/api/agents/prd/route.ts](src/app/api/agents/prd/route.ts)

Accept an optional `continue` field in the request body. When present:

```typescript
const continuationSystemAddendum = `
The following is a partially generated PRD that was interrupted mid-stream.
Continue writing from exactly where it left off. Do NOT repeat any content
already written. Pick up seamlessly from the last character.

--- PARTIAL DRAFT ---
${body.continue}
--- END PARTIAL DRAFT ---
`;
```

Append this to the system prompt before calling `streamText`. The client will prepend the existing partial content to the streamed continuation chunks.

### 5. Check `res.ok` before consuming stream body

**File:** [src/app/workspaces/[id]/WorkspaceDetailClient.tsx](src/app/workspaces/[id]/WorkspaceDetailClient.tsx)

Before entering `res.body.getReader()`, check `if (!res.ok)` and show a user-visible error. Currently, a 500 JSON error response would be decoded as text and silently treated as model output.

### 6. PRD revision path: also update `prd_documents`

**File:** [src/app/workspaces/[id]/WorkspaceDetailClient.tsx](src/app/workspaces/[id]/WorkspaceDetailClient.tsx)

In `handleSend` when `isPrd` is true (lines 432-434), after the stream completes, also call `PUT /api/features/{id}/prd` with the final content. Currently only `persistMessage` runs, leaving `prd_documents` stale until the user manually clicks "Save Changes."

## Files Modified

- `src/app/workspaces/[id]/WorkspaceDetailClient.tsx` -- mid-stream saves, beforeunload, res.ok check, revision PRD save, recovery detection on hydration, continue/regenerate handlers
- `src/components/PrdRecoveryBanner.tsx` -- new component: recovery banner with 3 action buttons (Continue / Regenerate / Edit)
- `src/app/api/agents/prd/route.ts` -- server-side onFinish persistence + `continue` mode for resuming interrupted drafts
- `supabase/schema.sql` -- add `generating` to status check constraint
- `MEMORY.md` -- changelog entry

## Recovery flow (end to end)

1. User approves competitor analysis -> feature status set to `generating` -> PRD stream begins
2. Mid-stream: debounced saves write partial content to `prd_documents` every ~3s
3. **If stream completes normally:** status -> `done`, full content persisted (client + server fallback)
4. **If interrupted:** status stays `generating`, partial content exists in `prd_documents` from debounced saves
5. **User returns/reloads:** hydration detects `generating` status -> loads partial draft -> shows `PrdRecoveryBanner`
6. User picks one of:

- **Continue** -> append-mode stream resumes from partial draft
- **Regenerate** -> fresh generation replaces everything
- **Edit manually** -> status -> `review`, user edits and saves
