-- Run in Supabase SQL Editor after schema.sql if API routes return 500.
-- Next.js uses the anon key; without policies, RLS blocks all access.

alter table workspaces enable row level security;
alter table features enable row level security;
alter table prd_documents enable row level security;

drop policy if exists "workspaces_select_anon" on workspaces;
drop policy if exists "workspaces_insert_anon" on workspaces;
drop policy if exists "workspaces_update_anon" on workspaces;
drop policy if exists "workspaces_delete_anon" on workspaces;

create policy "workspaces_select_anon" on workspaces for select to anon using (true);
create policy "workspaces_insert_anon" on workspaces for insert to anon with check (true);
create policy "workspaces_update_anon" on workspaces for update to anon using (true);
create policy "workspaces_delete_anon" on workspaces for delete to anon using (true);

drop policy if exists "features_select_anon" on features;
drop policy if exists "features_insert_anon" on features;
drop policy if exists "features_update_anon" on features;
drop policy if exists "features_delete_anon" on features;

create policy "features_select_anon" on features for select to anon using (true);
create policy "features_insert_anon" on features for insert to anon with check (true);
create policy "features_update_anon" on features for update to anon using (true);
create policy "features_delete_anon" on features for delete to anon using (true);

drop policy if exists "prd_select_anon" on prd_documents;
drop policy if exists "prd_insert_anon" on prd_documents;
drop policy if exists "prd_update_anon" on prd_documents;
drop policy if exists "prd_delete_anon" on prd_documents;

create policy "prd_select_anon" on prd_documents for select to anon using (true);
create policy "prd_insert_anon" on prd_documents for insert to anon with check (true);
create policy "prd_update_anon" on prd_documents for update to anon using (true);
create policy "prd_delete_anon" on prd_documents for delete to anon using (true);

alter table feature_messages enable row level security;

drop policy if exists "feature_messages_select_anon" on feature_messages;
drop policy if exists "feature_messages_insert_anon" on feature_messages;
drop policy if exists "feature_messages_update_anon" on feature_messages;
drop policy if exists "feature_messages_delete_anon" on feature_messages;

create policy "feature_messages_select_anon" on feature_messages for select to anon using (true);
create policy "feature_messages_insert_anon" on feature_messages for insert to anon with check (true);
create policy "feature_messages_update_anon" on feature_messages for update to anon using (true);
create policy "feature_messages_delete_anon" on feature_messages for delete to anon using (true);

alter table feature_artifacts enable row level security;

drop policy if exists "feature_artifacts_select_anon" on feature_artifacts;
drop policy if exists "feature_artifacts_insert_anon" on feature_artifacts;
drop policy if exists "feature_artifacts_update_anon" on feature_artifacts;
drop policy if exists "feature_artifacts_delete_anon" on feature_artifacts;

create policy "feature_artifacts_select_anon" on feature_artifacts for select to anon using (true);
create policy "feature_artifacts_insert_anon" on feature_artifacts for insert to anon with check (true);
create policy "feature_artifacts_update_anon" on feature_artifacts for update to anon using (true);
create policy "feature_artifacts_delete_anon" on feature_artifacts for delete to anon using (true);
