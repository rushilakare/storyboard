import type { AppSupabase } from './artifact-persistence';
import { resolvePrdContentForFeature } from './artifact-persistence';
import { computeEmbedding } from './embeddings';
import type { KnowledgeBaseNotice } from './knowledge/httpHeaders';
import { retrieveKnowledgeChunks } from './knowledge/retrieval';
import {
  COMPETITOR_OUTPUT_DISCIPLINE,
  INFERENCE_CLARIFYING_JSON_RULES,
  INFERENCE_OUTPUT_DISCIPLINE,
  INFERENCE_REVISION_FROM_TRANSCRIPT,
  PRD_OUTPUT_REQUIREMENTS,
  PRD_PRODUCT_CONTEXT,
  PRD_REVISION_INSTRUCTION,
  PRD_ROLE_INTRO,
  TRANSCRIPT_DISCIPLINE,
} from './agent-prompts';
import {
  formatAnswerForQuestion,
  isInferenceClarificationsV2,
  type ClarifyingQuestion,
} from './postInferenceQuestions';

interface AssembledContext {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  knowledgeBase: KnowledgeBaseNotice;
}

interface AssembleOptions {
  maxMessages?: number;
  maxChars?: number;
  enableRetrieval?: boolean;
  userQuery?: string;
  /** Current user — enables global knowledge base RAG (chunk retrieval). */
  userId?: string;
  /** When true, do not inject saved prd_documents into system (e.g. PRD continue mode already includes partial draft). */
  omitSavedPrdDocument?: boolean;
}

interface RetrievedChunk {
  id: string;
  feature_id: string;
  content: string;
  role: string;
  agent_type: string | null;
  similarity: number;
}

type DbMessage = {
  role: string;
  content: string;
  agent_type: string | null;
  sequence_num: number;
  token_count: number | null;
};

function includeMessageForAgent(m: DbMessage, agentKind: 'inference' | 'competitor' | 'prd'): boolean {
  if (m.role === 'system') return false;
  if (m.role === 'user') return true;
  if (m.role !== 'assistant') return false;

  const t = m.agent_type;
  if (agentKind === 'inference') {
    return t === 'inference' || t === null;
  }
  if (agentKind === 'competitor') {
    return t === 'inference' || t === 'competitor' || t === null;
  }
  return t === 'inference' || t === 'competitor' || t === null;
}

function applyCharBudget(messages: DbMessage[], maxChars: number): DbMessage[] {
  let charCount = 0;
  const out: DbMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (charCount + m.content.length > maxChars) break;
    out.unshift(m);
    charCount += m.content.length;
  }
  return out;
}

function buildInferenceSystem(
  featureBlock: string,
  retrievedSection: string,
): string {
  return [
    'You are an expert product management assistant simulating an inference agent for a linear-inspired tool.',
    INFERENCE_OUTPUT_DISCIPLINE,
    '',
    INFERENCE_REVISION_FROM_TRANSCRIPT,
    '',
    INFERENCE_CLARIFYING_JSON_RULES,
    '',
    TRANSCRIPT_DISCIPLINE,
    '',
    '### Feature Context',
    featureBlock,
    retrievedSection,
  ].join('\n');
}

function buildCompetitorSystem(
  featureBlock: string,
  retrievedSection: string,
): string {
  return [
    'You are an expert product management assistant simulating a Competitor Research Agent.',
    'Simulate a quick industry / competitive scan (no live web access): infer how comparable products typically approach similar capabilities.',
    COMPETITOR_OUTPUT_DISCIPLINE,
    '',
    TRANSCRIPT_DISCIPLINE,
    '',
    '### Feature Context',
    featureBlock,
    retrievedSection,
  ].join('\n');
}

function buildPrdSystem(
  featureBlock: string,
  retrievedSection: string,
  savedPrdSection: string,
  includeRevisionInstruction: boolean,
): string {
  const parts = [
    PRD_ROLE_INTRO,
    'Write a comprehensive PRD/Epic and break it down into detailed user stories in Markdown.',
    '',
    PRD_PRODUCT_CONTEXT,
    '',
    '### Feature Context',
    featureBlock,
    savedPrdSection,
    retrievedSection,
    PRD_OUTPUT_REQUIREMENTS,
  ];
  if (includeRevisionInstruction) {
    parts.push('', PRD_REVISION_INSTRUCTION);
  }
  return parts.join('\n');
}

export async function assembleFeatureContext(
  sb: AppSupabase,
  featureId: string,
  agentKind: 'inference' | 'competitor' | 'prd',
  options?: AssembleOptions,
): Promise<AssembledContext> {
  const maxMessages = options?.maxMessages ?? 24;
  const maxChars = options?.maxChars ?? (agentKind === 'prd' ? 12000 : 8000);

  const { data: feature, error: featureError } = await sb
    .from('features')
    .select('*')
    .eq('id', featureId)
    .single();

  if (featureError || !feature) throw new Error('Feature not found');

  const savedPrdContent =
    !options?.omitSavedPrdDocument && agentKind === 'prd'
      ? (await resolvePrdContentForFeature(sb, featureId)).trim()
      : '';

  const { data: dbMessages } = await sb
    .from('feature_messages')
    .select('role, content, agent_type, sequence_num, token_count')
    .eq('feature_id', featureId)
    .order('sequence_num', { ascending: false })
    .limit(maxMessages * 3);

  const chronological = (dbMessages ?? []).reverse() as DbMessage[];
  const filtered = chronological.filter((m) => includeMessageForAgent(m, agentKind));
  const trimmed = applyCharBudget(filtered, maxChars);

  const featureLines = [
    `Feature Name: ${feature.name}`,
    `Core Problem: ${feature.purpose || 'Not specified'}`,
    `Requirements: ${feature.requirements || 'None'}`,
    `Status: ${feature.status}`,
  ];

  const clar = feature.inference_clarifications;
  if (clar && typeof clar === 'object') {
    const obj = clar as Record<string, unknown>;
    if (isInferenceClarificationsV2(obj)) {
      const { questions, answers } = obj;
      if (questions.length > 0) {
        featureLines.push('', '### User clarifications (structured)');
        for (const q of questions as ClarifyingQuestion[]) {
          const val = answers[q.id];
          featureLines.push(`- ${q.title}: ${formatAnswerForQuestion(q, val)}`);
        }
      }
    } else {
      const entries = Object.entries(obj);
      if (entries.length > 0) {
        featureLines.push('', '### User clarifications (structured)');
        for (const [key, val] of entries) {
          if (val === null) continue;
          if (typeof val === 'string') {
            featureLines.push(`- ${key}: ${val}`);
          } else if (Array.isArray(val)) {
            featureLines.push(`- ${key}: ${val.join(', ')}`);
          } else if (typeof val === 'object' && val !== null && 'selected' in val) {
            const sel = val as { selected: string[]; other?: string };
            const parts = [...sel.selected];
            if (sel.other) parts.push(sel.other);
            featureLines.push(`- ${key}: ${parts.join(', ')}`);
          }
        }
      }
    }
  }

  const featureBlock = featureLines.join('\n');

  const knowledgeBase: KnowledgeBaseNotice = { consulted: false, sources: [] };

  let retrievedSection = '';
  if (options?.enableRetrieval && options.userQuery) {
    try {
      const chunks = await retrieveSemanticContext(
        sb,
        feature.workspace_id,
        options.userQuery,
        5,
        featureId,
      );
      if (chunks.length > 0) {
        retrievedSection =
          '\n\n### Relevant prior context (retrieved):\n' +
          chunks.map((c) => `- [${c.role}/${c.agent_type ?? 'unknown'}] ${c.content.slice(0, 300)}`).join('\n');
      }
    } catch {
      // Embedding or search failed — proceed without retrieval
    }
  }

  if (options?.userId) {
    const kbQuery = [
      feature.name,
      feature.purpose,
      feature.requirements,
      options.userQuery,
    ]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join('\n')
      .trim();
    if (kbQuery.length >= 12) {
      knowledgeBase.consulted = true;
      try {
        const kbChunks = await retrieveKnowledgeChunks(sb, kbQuery, 8);
        const seenDoc = new Set<string>();
        for (const c of kbChunks) {
          if (!seenDoc.has(c.document_id)) {
            seenDoc.add(c.document_id);
            knowledgeBase.sources.push(c.source_label);
          }
        }
        if (kbChunks.length > 0) {
          retrievedSection +=
            '\n\n### Knowledge base (retrieved excerpts)\n' +
            kbChunks
              .map((c) => `- [${c.source_label}] ${c.content.slice(0, 400)}`)
              .join('\n');
        }
      } catch {
        // proceed without KB retrieval
      }
    }
  }

  let savedPrdSection = '';
  if (savedPrdContent.length > 0) {
    savedPrdSection = [
      '',
      '### Current PRD (source of truth)',
      'The following is the latest saved PRD for this feature. For revisions, output a full replacement document that still satisfies Output Requirements below.',
      '',
      '--- CURRENT PRD START ---',
      savedPrdContent,
      '--- CURRENT PRD END ---',
    ].join('\n');
  }

  let systemPrompt: string;
  if (agentKind === 'inference') {
    systemPrompt = buildInferenceSystem(featureBlock, retrievedSection);
  } else if (agentKind === 'competitor') {
    systemPrompt = buildCompetitorSystem(featureBlock, retrievedSection);
  } else {
    systemPrompt = buildPrdSystem(
      featureBlock,
      retrievedSection,
      savedPrdSection,
      Boolean(options?.userQuery?.trim()),
    );
  }

  const conversationMessages: AssembledContext['messages'] = trimmed
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }));

  if (conversationMessages.length === 0) {
    conversationMessages.push({
      role: 'user',
      content: `I want to build: ${feature.name}\n\nPurpose: ${feature.purpose || 'Not specified'}\nRequirements: ${feature.requirements || 'None'}`,
    });
  }

  return { systemPrompt, messages: conversationMessages, knowledgeBase };
}

export async function retrieveSemanticContext(
  sb: AppSupabase,
  workspaceId: string,
  queryText: string,
  topK = 5,
  featureId?: string,
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await computeEmbedding(queryText);

  const rpcParams: {
    p_workspace_id: string;
    p_query_embedding: string;
    p_match_count: number;
    p_feature_id?: string;
  } = {
    p_workspace_id: workspaceId,
    p_query_embedding: `[${queryEmbedding.join(',')}]`,
    p_match_count: topK,
  };
  if (featureId) rpcParams.p_feature_id = featureId;

  const { data, error } = await sb.rpc(
    'match_feature_messages',
    rpcParams,
  );

  if (error) {
    console.error('[context] semantic retrieval failed', error);
    return [];
  }

  return (data ?? []) as RetrievedChunk[];
}

export async function searchFeatureMessages(
  sb: AppSupabase,
  workspaceId: string,
  query: string,
  topK = 20,
  featureId?: string,
) {
  const rpcParams: {
    p_workspace_id: string;
    p_query: string;
    p_match_count: number;
    p_feature_id?: string;
  } = {
    p_workspace_id: workspaceId,
    p_query: query,
    p_match_count: topK,
  };
  if (featureId) rpcParams.p_feature_id = featureId;

  const { data, error } = await sb.rpc(
    'search_feature_messages',
    rpcParams,
  );

  if (error) {
    console.error('[context] FTS search failed', error);
    return [];
  }

  return data ?? [];
}

/**
 * Hybrid search: combine FTS + vector results via reciprocal rank fusion.
 */
export async function hybridSearch(
  sb: AppSupabase,
  workspaceId: string,
  query: string,
  topK = 10,
  featureId?: string,
) {
  const [ftsResults, vectorResults] = await Promise.allSettled([
    searchFeatureMessages(sb, workspaceId, query, topK * 2, featureId),
    retrieveSemanticContext(sb, workspaceId, query, topK * 2, featureId),
  ]);

  const k = 60; // RRF constant
  const scores = new Map<string, { score: number; content: string; role: string; agent_type: string | null }>();

  if (ftsResults.status === 'fulfilled') {
    ftsResults.value.forEach((r: { id: string; content: string; role: string; agent_type: string | null }, i: number) => {
      const prev = scores.get(r.id);
      const rrf = 1 / (k + i + 1);
      scores.set(r.id, {
        score: (prev?.score ?? 0) + rrf,
        content: r.content,
        role: r.role,
        agent_type: r.agent_type,
      });
    });
  }

  if (vectorResults.status === 'fulfilled') {
    vectorResults.value.forEach((r, i) => {
      const prev = scores.get(r.id);
      const rrf = 1 / (k + i + 1);
      scores.set(r.id, {
        score: (prev?.score ?? 0) + rrf,
        content: r.content,
        role: r.role,
        agent_type: r.agent_type,
      });
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topK)
    .map(([id, val]) => ({ id, ...val }));
}
