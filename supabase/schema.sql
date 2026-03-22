-- Supabase Schema for Rushi PM Tool
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- After this file, run rls-policies.sql so Next.js API routes (anon key) can read/write.

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Workspaces
create table if not exists workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Features (belong to a workspace)
create table if not exists features (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  purpose text,
  requirements text,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'review', 'generating', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  inference_clarifications jsonb,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- PRD Documents (1:1 with feature)
create table if not exists prd_documents (
  id uuid primary key default uuid_generate_v4(),
  content text not null default '',
  feature_id uuid not null unique references features(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable pgvector for semantic search
create extension if not exists vector;

-- Feature messages (append-only chat log per feature)
create table if not exists feature_messages (
  id uuid primary key default uuid_generate_v4(),
  feature_id uuid not null references features(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  sequence_num int not null,
  agent_type text,
  token_count int,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  search_vector tsvector,
  embedding vector(1536),
  unique (feature_id, sequence_num)
);

-- Feature artifacts (versioned blobs linked to a feature; not stored in chat rows)
create table if not exists feature_artifacts (
  id uuid primary key default uuid_generate_v4(),
  feature_id uuid not null references features(id) on delete cascade,
  kind text not null,
  mime_type text not null default 'text/markdown',
  title text,
  body text,
  storage_path text,
  version int not null,
  is_draft boolean not null default false,
  source_message_id uuid references feature_messages(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feature_id, kind, version),
  constraint feature_artifacts_body_or_storage check (body is not null or storage_path is not null)
);

-- Indexes
create index if not exists idx_features_workspace on features(workspace_id);
create index if not exists idx_prd_feature on prd_documents(feature_id);
create index if not exists idx_feature_messages_feature_seq on feature_messages(feature_id, sequence_num);
create index if not exists idx_feature_messages_fts on feature_messages using gin(search_vector);
create index if not exists idx_feature_messages_embedding on feature_messages using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index if not exists idx_feature_artifacts_feature_kind_version on feature_artifacts (feature_id, kind, version desc);
create index if not exists idx_feature_artifacts_feature_draft on feature_artifacts (feature_id, kind) where is_draft = true;

-- Auto-update updated_at on row changes
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger workspaces_updated_at before update on workspaces
  for each row execute function update_updated_at();

create trigger features_updated_at before update on features
  for each row execute function update_updated_at();

create trigger prd_documents_updated_at before update on prd_documents
  for each row execute function update_updated_at();

create trigger feature_artifacts_updated_at before update on feature_artifacts
  for each row execute function update_updated_at();

-- Auto-populate search_vector on feature_messages insert/update
create or replace function feature_messages_search_trigger()
returns trigger as $$
begin
  new.search_vector := to_tsvector('english', coalesce(new.content, ''));
  return new;
end;
$$ language plpgsql;

create trigger feature_messages_search_update
  before insert or update of content on feature_messages
  for each row execute function feature_messages_search_trigger();

-- Vector similarity search scoped by workspace
create or replace function match_feature_messages(
  p_workspace_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 5,
  p_feature_id uuid default null
) returns table (
  id uuid,
  feature_id uuid,
  content text,
  role text,
  agent_type text,
  similarity float
) language plpgsql as $$
begin
  return query
    select
      fm.id,
      fm.feature_id,
      fm.content,
      fm.role,
      fm.agent_type,
      1 - (fm.embedding <=> p_query_embedding) as similarity
    from feature_messages fm
    join features f on f.id = fm.feature_id
    where f.workspace_id = p_workspace_id
      and fm.embedding is not null
      and (p_feature_id is null or fm.feature_id = p_feature_id)
    order by fm.embedding <=> p_query_embedding
    limit p_match_count;
end;
$$;

-- Lexical (FTS) search scoped by workspace
create or replace function search_feature_messages(
  p_workspace_id uuid,
  p_query text,
  p_match_count int default 20,
  p_feature_id uuid default null
) returns table (
  id uuid,
  feature_id uuid,
  content text,
  role text,
  agent_type text,
  rank float
) language plpgsql as $$
begin
  return query
    select
      fm.id,
      fm.feature_id,
      fm.content,
      fm.role,
      fm.agent_type,
      ts_rank(fm.search_vector, plainto_tsquery('english', p_query)) as rank
    from feature_messages fm
    join features f on f.id = fm.feature_id
    where f.workspace_id = p_workspace_id
      and fm.search_vector @@ plainto_tsquery('english', p_query)
      and (p_feature_id is null or fm.feature_id = p_feature_id)
    order by rank desc
    limit p_match_count;
end;
$$;

-- Seed data: one default workspace with sample features
insert into workspaces (name, description) values
  ('Global Team', 'Main product workspace for the global team'),
  ('Mobile App', 'iOS and Android mobile application'),
  ('Design System', 'Shared component library and design tokens')
on conflict do nothing;
