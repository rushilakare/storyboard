-- RLS for authenticated users: workspace owner (created_by = auth.uid()).
-- Run after schema.sql and migration-auth-iam.sql (or use migration-auth-iam.sql alone on existing DBs that already enabled RLS).
-- The app uses the anon key with a logged-in user JWT (Supabase Auth).

alter table workspaces enable row level security;
alter table features enable row level security;
alter table prd_documents enable row level security;
alter table feature_messages enable row level security;
alter table feature_artifacts enable row level security;
alter table knowledge_documents enable row level security;
alter table knowledge_chunks enable row level security;
alter table ai_usage_events enable row level security;

drop policy if exists "workspaces_select_anon" on workspaces;
drop policy if exists "workspaces_insert_anon" on workspaces;
drop policy if exists "workspaces_update_anon" on workspaces;
drop policy if exists "workspaces_delete_anon" on workspaces;
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

drop policy if exists "features_select_anon" on features;
drop policy if exists "features_insert_anon" on features;
drop policy if exists "features_update_anon" on features;
drop policy if exists "features_delete_anon" on features;
drop policy if exists "features_select_own" on features;
drop policy if exists "features_insert_own" on features;
drop policy if exists "features_update_own" on features;
drop policy if exists "features_delete_own" on features;

create policy "features_select_own" on features for select to authenticated
  using (
    exists (
      select 1 from workspaces w
      where w.id = features.workspace_id and w.created_by = auth.uid()
    )
  );

create policy "features_insert_own" on features for insert to authenticated
  with check (
    exists (
      select 1 from workspaces w
      where w.id = workspace_id and w.created_by = auth.uid()
    )
  );

create policy "features_update_own" on features for update to authenticated
  using (
    exists (
      select 1 from workspaces w
      where w.id = features.workspace_id and w.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from workspaces w
      where w.id = features.workspace_id and w.created_by = auth.uid()
    )
  );

create policy "features_delete_own" on features for delete to authenticated
  using (
    exists (
      select 1 from workspaces w
      where w.id = features.workspace_id and w.created_by = auth.uid()
    )
  );

drop policy if exists "prd_select_anon" on prd_documents;
drop policy if exists "prd_insert_anon" on prd_documents;
drop policy if exists "prd_update_anon" on prd_documents;
drop policy if exists "prd_delete_anon" on prd_documents;
drop policy if exists "prd_select_own" on prd_documents;
drop policy if exists "prd_insert_own" on prd_documents;
drop policy if exists "prd_update_own" on prd_documents;
drop policy if exists "prd_delete_own" on prd_documents;

create policy "prd_select_own" on prd_documents for select to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = prd_documents.feature_id and w.created_by = auth.uid()
    )
  );

create policy "prd_insert_own" on prd_documents for insert to authenticated
  with check (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_id and w.created_by = auth.uid()
    )
  );

create policy "prd_update_own" on prd_documents for update to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = prd_documents.feature_id and w.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_id and w.created_by = auth.uid()
    )
  );

create policy "prd_delete_own" on prd_documents for delete to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = prd_documents.feature_id and w.created_by = auth.uid()
    )
  );

drop policy if exists "feature_messages_select_anon" on feature_messages;
drop policy if exists "feature_messages_insert_anon" on feature_messages;
drop policy if exists "feature_messages_update_anon" on feature_messages;
drop policy if exists "feature_messages_delete_anon" on feature_messages;
drop policy if exists "feature_messages_select_own" on feature_messages;
drop policy if exists "feature_messages_insert_own" on feature_messages;
drop policy if exists "feature_messages_update_own" on feature_messages;
drop policy if exists "feature_messages_delete_own" on feature_messages;

create policy "feature_messages_select_own" on feature_messages for select to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_messages.feature_id and w.created_by = auth.uid()
    )
  );

create policy "feature_messages_insert_own" on feature_messages for insert to authenticated
  with check (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_id and w.created_by = auth.uid()
    )
  );

create policy "feature_messages_update_own" on feature_messages for update to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_messages.feature_id and w.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_id and w.created_by = auth.uid()
    )
  );

create policy "feature_messages_delete_own" on feature_messages for delete to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_messages.feature_id and w.created_by = auth.uid()
    )
  );

drop policy if exists "feature_artifacts_select_anon" on feature_artifacts;
drop policy if exists "feature_artifacts_insert_anon" on feature_artifacts;
drop policy if exists "feature_artifacts_update_anon" on feature_artifacts;
drop policy if exists "feature_artifacts_delete_anon" on feature_artifacts;
drop policy if exists "feature_artifacts_select_own" on feature_artifacts;
drop policy if exists "feature_artifacts_insert_own" on feature_artifacts;
drop policy if exists "feature_artifacts_update_own" on feature_artifacts;
drop policy if exists "feature_artifacts_delete_own" on feature_artifacts;

create policy "feature_artifacts_select_own" on feature_artifacts for select to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_artifacts.feature_id and w.created_by = auth.uid()
    )
  );

create policy "feature_artifacts_insert_own" on feature_artifacts for insert to authenticated
  with check (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_id and w.created_by = auth.uid()
    )
  );

create policy "feature_artifacts_update_own" on feature_artifacts for update to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_artifacts.feature_id and w.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_id and w.created_by = auth.uid()
    )
  );

create policy "feature_artifacts_delete_own" on feature_artifacts for delete to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_artifacts.feature_id and w.created_by = auth.uid()
    )
  );

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

drop policy if exists "ai_usage_events_select_own" on ai_usage_events;
drop policy if exists "ai_usage_events_insert_own" on ai_usage_events;

create policy "ai_usage_events_select_own" on ai_usage_events for select to authenticated
  using (user_id = auth.uid());

create policy "ai_usage_events_insert_own" on ai_usage_events for insert to authenticated
  with check (user_id = auth.uid());
