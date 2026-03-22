export type Database = {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          created_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      features: {
        Row: {
          id: string;
          name: string;
          purpose: string | null;
          requirements: string | null;
          status: 'draft' | 'in_progress' | 'review' | 'generating' | 'done';
          priority: 'low' | 'medium' | 'high';
          inference_clarifications: Record<string, unknown> | null;
          workspace_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          purpose?: string | null;
          requirements?: string | null;
          status?: 'draft' | 'in_progress' | 'review' | 'generating' | 'done';
          priority?: 'low' | 'medium' | 'high';
          inference_clarifications?: Record<string, unknown> | null;
          workspace_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          purpose?: string | null;
          requirements?: string | null;
          status?: 'draft' | 'in_progress' | 'review' | 'generating' | 'done';
          priority?: 'low' | 'medium' | 'high';
          inference_clarifications?: Record<string, unknown> | null;
          workspace_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'features_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      prd_documents: {
        Row: {
          id: string;
          content: string;
          feature_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          content: string;
          feature_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          content?: string;
          feature_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'prd_documents_feature_id_fkey';
            columns: ['feature_id'];
            isOneToOne: true;
            referencedRelation: 'features';
            referencedColumns: ['id'];
          },
        ];
      };
      feature_artifacts: {
        Row: {
          id: string;
          feature_id: string;
          kind: string;
          mime_type: string;
          title: string | null;
          body: string | null;
          storage_path: string | null;
          version: number;
          is_draft: boolean;
          source_message_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          feature_id: string;
          kind: string;
          mime_type?: string;
          title?: string | null;
          body?: string | null;
          storage_path?: string | null;
          version: number;
          is_draft?: boolean;
          source_message_id?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string | null;
          body?: string | null;
          storage_path?: string | null;
          is_draft?: boolean;
          source_message_id?: string | null;
          metadata?: Record<string, unknown>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feature_artifacts_feature_id_fkey';
            columns: ['feature_id'];
            isOneToOne: false;
            referencedRelation: 'features';
            referencedColumns: ['id'];
          },
        ];
      };
      feature_messages: {
        Row: {
          id: string;
          feature_id: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
          sequence_num: number;
          agent_type: string | null;
          token_count: number | null;
          metadata: Record<string, unknown>;
          created_at: string;
          search_vector: string | null;
          embedding: string | null;
        };
        Insert: {
          id?: string;
          feature_id: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
          sequence_num: number;
          agent_type?: string | null;
          token_count?: number | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
          embedding?: string | null;
        };
        Update: {
          id?: string;
          content?: string;
          token_count?: number | null;
          metadata?: Record<string, unknown>;
          embedding?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'feature_messages_feature_id_fkey';
            columns: ['feature_id'];
            isOneToOne: false;
            referencedRelation: 'features';
            referencedColumns: ['id'];
          },
        ];
      };
      knowledge_documents: {
        Row: {
          id: string;
          user_id: string;
          source_kind: 'upload' | 'text';
          filename: string;
          title: string | null;
          mime_type: string;
          byte_size: number;
          storage_path: string | null;
          body: string | null;
          status: 'pending' | 'processing' | 'ready' | 'failed';
          error_message: string | null;
          chunk_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_kind: 'upload' | 'text';
          filename: string;
          title?: string | null;
          mime_type: string;
          byte_size?: number;
          storage_path?: string | null;
          body?: string | null;
          status?: 'pending' | 'processing' | 'ready' | 'failed';
          error_message?: string | null;
          chunk_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          filename?: string;
          title?: string | null;
          mime_type?: string;
          byte_size?: number;
          storage_path?: string | null;
          body?: string | null;
          status?: 'pending' | 'processing' | 'ready' | 'failed';
          error_message?: string | null;
          chunk_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      knowledge_chunks: {
        Row: {
          id: string;
          document_id: string;
          user_id: string;
          chunk_index: number;
          content: string;
          embedding: string | null;
          search_vector: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          user_id: string;
          chunk_index: number;
          content: string;
          embedding?: string | null;
          created_at?: string;
        };
        Update: {
          content?: string;
          embedding?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_chunks_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_documents';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      match_feature_messages: {
        Args: {
          p_workspace_id: string;
          p_query_embedding: string;
          p_match_count?: number;
          p_feature_id?: string;
        };
        Returns: Array<{
          id: string;
          feature_id: string;
          content: string;
          role: string;
          agent_type: string | null;
          similarity: number;
        }>;
      };
      search_feature_messages: {
        Args: {
          p_workspace_id: string;
          p_query: string;
          p_match_count?: number;
          p_feature_id?: string;
        };
        Returns: Array<{
          id: string;
          feature_id: string;
          content: string;
          role: string;
          agent_type: string | null;
          rank: number;
        }>;
      };
      match_knowledge_chunks: {
        Args: {
          p_query_embedding: string;
          p_match_count?: number;
        };
        Returns: Array<{
          id: string;
          document_id: string;
          source_label: string;
          content: string;
          similarity: number;
        }>;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// Convenience types
export type Workspace = Database['public']['Tables']['workspaces']['Row'];
export type Feature = Database['public']['Tables']['features']['Row'];
export type PrdDocument = Database['public']['Tables']['prd_documents']['Row'];
export type FeatureArtifact = Database['public']['Tables']['feature_artifacts']['Row'];
export type FeatureMessage = Database['public']['Tables']['feature_messages']['Row'];
export type KnowledgeDocument = Database['public']['Tables']['knowledge_documents']['Row'];
export type KnowledgeChunk = Database['public']['Tables']['knowledge_chunks']['Row'];
