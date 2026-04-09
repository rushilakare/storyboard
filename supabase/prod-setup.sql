-- =============================================================
-- Speqtr — Production Database Setup
-- Run this once in the new Supabase project's SQL Editor.
-- This is a combined, idempotent script for a fresh database.
-- =============================================================


-- ---------------------------------------------------------------
-- SECTION 1: Extensions
-- ---------------------------------------------------------------

create extension if not exists "uuid-ossp";
create extension if not exists vector;


-- ---------------------------------------------------------------
-- SECTION 2: Tables
-- ---------------------------------------------------------------

create table if not exists workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  created_by uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists prd_documents (
  id uuid primary key default uuid_generate_v4(),
  content text not null default '',
  feature_id uuid not null unique references features(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists knowledge_documents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_kind text not null check (source_kind in ('upload', 'text')),
  filename text not null,
  title text,
  mime_type text not null,
  byte_size bigint not null default 0,
  storage_path text,
  body text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  error_message text,
  chunk_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_documents_source_shape check (
    (source_kind = 'upload' and storage_path is not null and body is null)
    or (source_kind = 'text' and body is not null and storage_path is null)
  )
);

create table if not exists knowledge_chunks (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references knowledge_documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1536),
  search_vector tsvector,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table if not exists ai_usage_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feature_id uuid references features (id) on delete set null,
  source text not null,
  model_id text not null,
  input_tokens int,
  output_tokens int,
  total_tokens int,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------
-- SECTION 3: Indexes
-- ---------------------------------------------------------------

create index if not exists idx_features_workspace on features(workspace_id);
create index if not exists idx_prd_feature on prd_documents(feature_id);
create index if not exists idx_feature_messages_feature_seq on feature_messages(feature_id, sequence_num);
create index if not exists idx_feature_messages_fts on feature_messages using gin(search_vector);
create index if not exists idx_feature_messages_embedding on feature_messages using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index if not exists idx_feature_artifacts_feature_kind_version on feature_artifacts (feature_id, kind, version desc);
create index if not exists idx_feature_artifacts_feature_draft on feature_artifacts (feature_id, kind) where is_draft = true;
create index if not exists idx_knowledge_documents_user_created on knowledge_documents (user_id, created_at desc);
create index if not exists idx_knowledge_chunks_document on knowledge_chunks (document_id);
create index if not exists idx_knowledge_chunks_embedding on knowledge_chunks using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index if not exists idx_knowledge_chunks_fts on knowledge_chunks using gin (search_vector);
create index if not exists idx_ai_usage_events_user_created on ai_usage_events (user_id, created_at desc);
create index if not exists idx_ai_usage_events_user_model on ai_usage_events (user_id, model_id);


-- ---------------------------------------------------------------
-- SECTION 4: Functions & Triggers
-- ---------------------------------------------------------------

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

drop trigger if exists knowledge_documents_updated_at on knowledge_documents;
create trigger knowledge_documents_updated_at before update on knowledge_documents
  for each row execute function update_updated_at();

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

create or replace function knowledge_chunks_search_trigger()
returns trigger as $$
begin
  new.search_vector := to_tsvector('english', coalesce(new.content, ''));
  return new;
end;
$$ language plpgsql;

drop trigger if exists knowledge_chunks_search_update on knowledge_chunks;
create trigger knowledge_chunks_search_update
  before insert or update of content on knowledge_chunks
  for each row execute function knowledge_chunks_search_trigger();

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

create or replace function match_knowledge_chunks(
  p_query_embedding vector(1536),
  p_match_count int default 8
) returns table (
  id uuid,
  document_id uuid,
  source_label text,
  content text,
  similarity float
) language sql stable security invoker as $$
  select
    kc.id,
    kc.document_id,
    coalesce(kd.title, kd.filename, 'Untitled') as source_label,
    kc.content,
    (1 - (kc.embedding <=> p_query_embedding))::float as similarity
  from knowledge_chunks kc
  join knowledge_documents kd on kd.id = kc.document_id
  where kd.user_id = auth.uid()
    and kc.embedding is not null
  order by kc.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 50));
$$;

grant execute on function match_knowledge_chunks(vector, int) to authenticated;


-- ---------------------------------------------------------------
-- SECTION 5: Storage bucket
-- ---------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('knowledge', 'knowledge', false, 15728640)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "knowledge_select_own" on storage.objects;
drop policy if exists "knowledge_insert_own" on storage.objects;
drop policy if exists "knowledge_update_own" on storage.objects;
drop policy if exists "knowledge_delete_own" on storage.objects;

create policy "knowledge_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'knowledge' and split_part(name, '/', 1) = auth.uid()::text);

create policy "knowledge_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'knowledge' and split_part(name, '/', 1) = auth.uid()::text);

create policy "knowledge_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'knowledge' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'knowledge' and split_part(name, '/', 1) = auth.uid()::text);

create policy "knowledge_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'knowledge' and split_part(name, '/', 1) = auth.uid()::text);


-- ---------------------------------------------------------------
-- SECTION 6: Row Level Security
-- ---------------------------------------------------------------

alter table workspaces enable row level security;
alter table features enable row level security;
alter table prd_documents enable row level security;
alter table feature_messages enable row level security;
alter table feature_artifacts enable row level security;
alter table knowledge_documents enable row level security;
alter table knowledge_chunks enable row level security;
alter table ai_usage_events enable row level security;

-- workspaces
drop policy if exists "workspaces_select_own" on workspaces;
drop policy if exists "workspaces_insert_own" on workspaces;
drop policy if exists "workspaces_update_own" on workspaces;
drop policy if exists "workspaces_delete_own" on workspaces;

create policy "workspaces_select_own" on workspaces for select to authenticated
  using (created_by = auth.uid());

create policy "workspaces_insert_own" on workspaces for insert to authenticated
  with check (created_by = auth.uid());

create policy "workspaces_update_own" on workspaces for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "workspaces_delete_own" on workspaces for delete to authenticated
  using (created_by = auth.uid());

-- features
drop policy if exists "features_select_own" on features;
drop policy if exists "features_insert_own" on features;
drop policy if exists "features_update_own" on features;
drop policy if exists "features_delete_own" on features;

create policy "features_select_own" on features for select to authenticated
  using (exists (select 1 from workspaces w where w.id = features.workspace_id and w.created_by = auth.uid()));

create policy "features_insert_own" on features for insert to authenticated
  with check (exists (select 1 from workspaces w where w.id = workspace_id and w.created_by = auth.uid()));

create policy "features_update_own" on features for update to authenticated
  using (exists (select 1 from workspaces w where w.id = features.workspace_id and w.created_by = auth.uid()))
  with check (exists (select 1 from workspaces w where w.id = features.workspace_id and w.created_by = auth.uid()));

create policy "features_delete_own" on features for delete to authenticated
  using (exists (select 1 from workspaces w where w.id = features.workspace_id and w.created_by = auth.uid()));

-- prd_documents
drop policy if exists "prd_select_own" on prd_documents;
drop policy if exists "prd_insert_own" on prd_documents;
drop policy if exists "prd_update_own" on prd_documents;
drop policy if exists "prd_delete_own" on prd_documents;

create policy "prd_select_own" on prd_documents for select to authenticated
  using (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = prd_documents.feature_id and w.created_by = auth.uid()));

create policy "prd_insert_own" on prd_documents for insert to authenticated
  with check (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_id and w.created_by = auth.uid()));

create policy "prd_update_own" on prd_documents for update to authenticated
  using (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = prd_documents.feature_id and w.created_by = auth.uid()))
  with check (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_id and w.created_by = auth.uid()));

create policy "prd_delete_own" on prd_documents for delete to authenticated
  using (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = prd_documents.feature_id and w.created_by = auth.uid()));

-- feature_messages
drop policy if exists "feature_messages_select_own" on feature_messages;
drop policy if exists "feature_messages_insert_own" on feature_messages;
drop policy if exists "feature_messages_update_own" on feature_messages;
drop policy if exists "feature_messages_delete_own" on feature_messages;

create policy "feature_messages_select_own" on feature_messages for select to authenticated
  using (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_messages.feature_id and w.created_by = auth.uid()));

create policy "feature_messages_insert_own" on feature_messages for insert to authenticated
  with check (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_id and w.created_by = auth.uid()));

create policy "feature_messages_update_own" on feature_messages for update to authenticated
  using (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_messages.feature_id and w.created_by = auth.uid()))
  with check (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_id and w.created_by = auth.uid()));

create policy "feature_messages_delete_own" on feature_messages for delete to authenticated
  using (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_messages.feature_id and w.created_by = auth.uid()));

-- feature_artifacts
drop policy if exists "feature_artifacts_select_own" on feature_artifacts;
drop policy if exists "feature_artifacts_insert_own" on feature_artifacts;
drop policy if exists "feature_artifacts_update_own" on feature_artifacts;
drop policy if exists "feature_artifacts_delete_own" on feature_artifacts;

create policy "feature_artifacts_select_own" on feature_artifacts for select to authenticated
  using (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_artifacts.feature_id and w.created_by = auth.uid()));

create policy "feature_artifacts_insert_own" on feature_artifacts for insert to authenticated
  with check (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_id and w.created_by = auth.uid()));

create policy "feature_artifacts_update_own" on feature_artifacts for update to authenticated
  using (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_artifacts.feature_id and w.created_by = auth.uid()))
  with check (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_id and w.created_by = auth.uid()));

create policy "feature_artifacts_delete_own" on feature_artifacts for delete to authenticated
  using (exists (select 1 from features f join workspaces w on w.id = f.workspace_id where f.id = feature_artifacts.feature_id and w.created_by = auth.uid()));

-- knowledge_documents
drop policy if exists "knowledge_documents_select_own" on knowledge_documents;
drop policy if exists "knowledge_documents_insert_own" on knowledge_documents;
drop policy if exists "knowledge_documents_update_own" on knowledge_documents;
drop policy if exists "knowledge_documents_delete_own" on knowledge_documents;

create policy "knowledge_documents_select_own" on knowledge_documents for select to authenticated
  using (user_id = auth.uid());

create policy "knowledge_documents_insert_own" on knowledge_documents for insert to authenticated
  with check (user_id = auth.uid());

create policy "knowledge_documents_update_own" on knowledge_documents for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "knowledge_documents_delete_own" on knowledge_documents for delete to authenticated
  using (user_id = auth.uid());

-- knowledge_chunks
drop policy if exists "knowledge_chunks_select_own" on knowledge_chunks;
drop policy if exists "knowledge_chunks_insert_own" on knowledge_chunks;
drop policy if exists "knowledge_chunks_update_own" on knowledge_chunks;
drop policy if exists "knowledge_chunks_delete_own" on knowledge_chunks;

create policy "knowledge_chunks_select_own" on knowledge_chunks for select to authenticated
  using (user_id = auth.uid());

create policy "knowledge_chunks_insert_own" on knowledge_chunks for insert to authenticated
  with check (user_id = auth.uid());

create policy "knowledge_chunks_update_own" on knowledge_chunks for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "knowledge_chunks_delete_own" on knowledge_chunks for delete to authenticated
  using (user_id = auth.uid());

-- ai_usage_events
drop policy if exists "ai_usage_events_select_own" on ai_usage_events;
drop policy if exists "ai_usage_events_insert_own" on ai_usage_events;

create policy "ai_usage_events_select_own" on ai_usage_events for select to authenticated
  using (user_id = auth.uid());

create policy "ai_usage_events_insert_own" on ai_usage_events for insert to authenticated
  with check (user_id = auth.uid());
