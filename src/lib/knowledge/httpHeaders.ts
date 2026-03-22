export type KnowledgeBaseNotice = {
  consulted: boolean;
  sources: string[];
};

export const KNOWLEDGE_BASE_RESPONSE_HEADER = 'x-pm-knowledge-base' as const;

export function knowledgeBaseHeaders(kb: KnowledgeBaseNotice): Record<string, string> {
  return {
    [KNOWLEDGE_BASE_RESPONSE_HEADER]: encodeURIComponent(JSON.stringify(kb)),
  };
}
