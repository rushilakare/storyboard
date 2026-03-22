-- IAM: Supabase Auth + workspace ownership (run in SQL Editor after schema exists).
-- 1) Adds workspaces.created_by → auth.users
-- 2) Replaces wide-open anon RLS with authenticated + owner checks
--
-- After running: assign legacy rows if needed, then sign in via the app.
--   update workspaces set created_by = '<your-auth.users.id>' where created_by is null;

alter table workspaces
  add column if not exists created_by uuid references auth.users (id) on delete cascade;

-- --- Drop legacy anon policies (names from rls-policies.sql) ---

drop policy if exists "workspaces_select_anon" on workspaces;
drop policy if exists "workspaces_insert_anon" on workspaces;
drop policy if exists "workspaces_update_anon" on workspaces;
drop policy if exists "workspaces_delete_anon" on workspaces;

drop policy if exists "features_select_anon" on features;
drop policy if exists "features_insert_anon" on features;
drop policy if exists "features_update_anon" on features;
drop policy if exists "features_delete_anon" on features;

drop policy if exists "prd_select_anon" on prd_documents;
drop policy if exists "prd_insert_anon" on prd_documents;
drop policy if exists "prd_update_anon" on prd_documents;
drop policy if exists "prd_delete_anon" on prd_documents;

drop policy if exists "feature_messages_select_anon" on feature_messages;
drop policy if exists "feature_messages_insert_anon" on feature_messages;
drop policy if exists "feature_messages_update_anon" on feature_messages;
drop policy if exists "feature_messages_delete_anon" on feature_messages;

drop policy if exists "feature_artifacts_select_anon" on feature_artifacts;
drop policy if exists "feature_artifacts_insert_anon" on feature_artifacts;
drop policy if exists "feature_artifacts_update_anon" on feature_artifacts;
drop policy if exists "feature_artifacts_delete_anon" on feature_artifacts;

-- --- Authenticated policies: workspace owner (created_by = auth.uid()) ---

create policy "workspaces_select_own" on workspaces for select to authenticated
  using (created_by = auth.uid());

create policy "workspaces_insert_own" on workspaces for insert to authenticated
  with check (created_by = auth.uid());

create policy "workspaces_update_own" on workspaces for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "workspaces_delete_own" on workspaces for delete to authenticated
  using (created_by = auth.uid());

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
