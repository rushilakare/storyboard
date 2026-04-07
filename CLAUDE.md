@AGENTS.md

# Speqtr — AI-Powered PRD Generation Tool

## Project Purpose
Speqtr helps product managers turn vague feature ideas into detailed PRDs via a multi-step AI agent pipeline. It is a full-stack Next.js SaaS app backed by Supabase and OpenAI.

## Tech Stack
- **Framework**: Next.js 16.2.1 (App Router, React 19)
- **Styling**: Tailwind CSS 4 + shadcn/ui + Radix UI
- **Rich Text**: TipTap 3 (prosemirror)
- **Database**: Supabase (PostgreSQL + pgvector for RAG)
- **Auth**: Supabase Auth (GitHub OAuth)
- **AI**: Vercel AI SDK + OpenAI (`gpt-5-4` for inference/PRD, `gpt-4o-mini` for chat)
- **Document Export**: docx, pdf-parse, turndown
- **Testing**: Vitest

## AI Agent Pipeline (Sequential)
1. **Clarifying Questions** — pre-inference Q&A (`/api/agents/infer-questions`)
2. **Inference** — problem framing, user value, technical considerations (`/api/agents/infer`)
3. **Competitor Analysis** — research competitor approaches (`/api/agents/competitor`)
4. **PRD Generation** — epics, user stories, acceptance criteria (`/api/agents/prd`)
5. **Discussion** — iterative refinement via chat (`/api/features/[id]/discuss`)

All agent endpoints stream responses. Each agent receives the full message transcript but only uses relevant parts (transcript discipline enforced in `src/lib/context.ts`).

## Key Files
- `src/lib/context.ts` — assembles AI prompt context (hybrid RAG: semantic + FTS)
- `src/lib/agent-prompts.ts` — system prompts for all agents
- `src/lib/artifact-persistence.ts` — versioned artifact CRUD
- `src/lib/knowledge/` — RAG pipeline (chunking, embedding, retrieval)
- `src/app/(main)/workspaces/[id]/WorkspaceDetailClient.tsx` — main workspace UI orchestrator
- `src/components/ChatInterface.tsx` — discussion chat panel
- `src/components/PrdDocumentEditor.tsx` — TipTap PRD editor
- `src/components/NewFeatureModal.tsx` — feature creation dialog

## Core Data Model
- **workspaces** — user-owned collections of features
- **features** — name, purpose, requirements, status (`draft|in_progress|review|generating|done`), priority (`low|medium|high`)
- **feature_messages** — append-only chat log with agent attribution + embeddings
- **feature_artifacts** — versioned docs (kind: `prd|inference|competitor`), draft states, inline markdown body
- **knowledge_documents + knowledge_chunks** — RAG source docs with embeddings and FTS vectors
- **ai_usage_events** — token tracking per model per user

## Architecture Patterns
- **Versioned artifacts**: every agent run bumps version; users can compare iterations
- **Hybrid search**: pgvector (semantic, HNSW cosine) + tsvector (FTS) on messages and knowledge chunks
- **Row-Level Security**: Supabase RLS enforces per-user data isolation; all queries respect auth context
- **Session bootstrap**: `sessionStorage` carries context from dashboard → workspace detail (`src/lib/newFeatureBootstrap.ts`)
- **Streaming**: all agent endpoints use Vercel AI SDK streaming
- **LLM usage tracking**: every AI call records tokens via `src/lib/ai/recordUsage.ts`

## Directory Layout
```
src/
  app/
    (main)/
      page.tsx                      # Dashboard
      workspaces/[id]/              # Primary feature workspace UI
      artifacts/, knowledge/, settings/
    api/
      agents/infer|infer-questions|competitor|prd
      features/[id]/prd|messages|artifacts|discuss
      workspaces/, knowledge/, search/, me/
    auth/, login/
  components/
    ui/                             # Base UI components
    artifacts/FeatureArtifactsPanel.tsx
  lib/
    context.ts, agent-prompts.ts
    artifact-persistence.ts, prd-persistence.ts
    knowledge/                      # RAG pipeline
    ai/recordUsage.ts
    auth/require-user.ts
supabase/
  schema.sql                        # Base schema
  migration-*.sql                   # Incremental migrations
  rls-policies.sql
```
