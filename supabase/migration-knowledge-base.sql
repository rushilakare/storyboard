-- Global per-user knowledge base: documents, chunked embeddings, RAG RPC.
-- Run in Supabase SQL Editor after schema.sql / existing migrations.
-- Also creates private Storage bucket `knowledge` + policies (path: {user_id}/...).

-- Tables
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

create index if not exists idx_knowledge_documents_user_created
  on knowledge_documents (user_id, created_at desc);
create index if not exists idx_knowledge_chunks_document on knowledge_chunks (document_id);
create index if not exists idx_knowledge_chunks_embedding
  on knowledge_chunks using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index if not exists idx_knowledge_chunks_fts on knowledge_chunks using gin (search_vector);

drop trigger if exists knowledge_documents_updated_at on knowledge_documents;
create trigger knowledge_documents_updated_at before update on knowledge_documents
  for each row execute function update_updated_at();

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

-- Storage bucket (private)
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

alter table knowledge_documents enable row level security;
alter table knowledge_chunks enable row level security;

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

grant execute on function match_knowledge_chunks(vector, int) to authenticated;
