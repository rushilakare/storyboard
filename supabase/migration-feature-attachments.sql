-- Migration: feature_attachments + feature_attachment_chunks
-- Enables per-feature file upload (images, PDFs, DOCX) with extraction, LLM summary, and chunked embeddings.

-- ─── Tables ───────────────────────────────────────────────────────────────────

create table if not exists feature_attachments (
  id             uuid primary key default uuid_generate_v4(),
  feature_id     uuid not null references features(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  filename       text not null,
  mime_type      text not null,
  byte_size      bigint not null default 0,
  storage_path   text not null,
  extracted_text text,
  summary        text,
  status         text not null default 'processing'
    check (status in ('processing', 'ready', 'failed')),
  error_message  text,
  chunk_count    int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists feature_attachment_chunks (
  id            uuid primary key default uuid_generate_v4(),
  attachment_id uuid not null references feature_attachments(id) on delete cascade,
  feature_id    uuid not null references features(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  chunk_index   int not null,
  content       text not null,
  embedding     vector(1536),
  search_vector tsvector,
  created_at    timestamptz not null default now(),
  unique (attachment_id, chunk_index)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists idx_feature_attachments_feature_status
  on feature_attachments(feature_id, status);

create index if not exists idx_feature_attachment_chunks_attachment
  on feature_attachment_chunks(attachment_id);

create index if not exists idx_feature_attachment_chunks_feature
  on feature_attachment_chunks(feature_id);

create index if not exists idx_feature_attachment_chunks_embedding
  on feature_attachment_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_feature_attachment_chunks_fts
  on feature_attachment_chunks using gin(search_vector);

-- ─── Triggers ─────────────────────────────────────────────────────────────────

create trigger feature_attachments_updated_at
  before update on feature_attachments
  for each row execute function update_updated_at();

create or replace function feature_attachment_chunks_search_trigger()
returns trigger as $$
begin
  new.search_vector := to_tsvector('english', coalesce(new.content, ''));
  return new;
end;
$$ language plpgsql;

create trigger feature_attachment_chunks_search_update
  before insert or update of content on feature_attachment_chunks
  for each row execute function feature_attachment_chunks_search_trigger();

-- ─── Storage bucket ───────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('features', 'features', false, 15728640)
on conflict (id) do nothing;

-- ─── RLS: feature_attachments ─────────────────────────────────────────────────

alter table feature_attachments enable row level security;

create policy "feature_attachments_select_own" on feature_attachments
  for select to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_attachments.feature_id
        and w.created_by = auth.uid()
    )
  );

create policy "feature_attachments_insert_own" on feature_attachments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_id
        and w.created_by = auth.uid()
    )
  );

create policy "feature_attachments_update_own" on feature_attachments
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "feature_attachments_delete_own" on feature_attachments
  for delete to authenticated
  using (user_id = auth.uid());

-- ─── RLS: feature_attachment_chunks ───────────────────────────────────────────

alter table feature_attachment_chunks enable row level security;

create policy "feature_attachment_chunks_select_own" on feature_attachment_chunks
  for select to authenticated
  using (user_id = auth.uid());

create policy "feature_attachment_chunks_insert_own" on feature_attachment_chunks
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "feature_attachment_chunks_update_own" on feature_attachment_chunks
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "feature_attachment_chunks_delete_own" on feature_attachment_chunks
  for delete to authenticated
  using (user_id = auth.uid());

-- ─── RLS: storage bucket "features" ──────────────────────────────────────────

create policy "features_storage_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'features' and split_part(name, '/', 1) = auth.uid()::text);

create policy "features_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'features' and split_part(name, '/', 1) = auth.uid()::text);

create policy "features_storage_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'features' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'features' and split_part(name, '/', 1) = auth.uid()::text);

create policy "features_storage_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'features' and split_part(name, '/', 1) = auth.uid()::text);

-- ─── RPC: match_feature_attachment_chunks ─────────────────────────────────────

create or replace function match_feature_attachment_chunks(
  p_feature_id      uuid,
  p_query_embedding vector(1536),
  p_match_count     int default 6
)
returns table (
  id            uuid,
  attachment_id uuid,
  filename      text,
  content       text,
  similarity    float
)
language sql stable as $$
  select
    fac.id,
    fac.attachment_id,
    fa.filename,
    fac.content,
    1 - (fac.embedding <=> p_query_embedding) as similarity
  from feature_attachment_chunks fac
  join feature_attachments fa on fa.id = fac.attachment_id
  where fac.feature_id = p_feature_id
    and fa.status = 'ready'
  order by fac.embedding <=> p_query_embedding
  limit p_match_count;
$$;
