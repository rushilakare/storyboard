-- Incremental migration: feature_issues (run in Supabase SQL editor if schema.sql was applied earlier without this table).

create table if not exists feature_issues (
  id uuid primary key default uuid_generate_v4(),
  feature_id uuid not null references features(id) on delete cascade,
  parent_id uuid references feature_issues(id) on delete cascade,
  type text not null check (type in ('epic', 'story')),
  issue_key text not null,
  title text not null,
  description text not null default '',
  acceptance_criteria jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feature_id, issue_key),
  constraint feature_issues_parent_shape check (
    (type = 'epic' and parent_id is null)
    or (type = 'story' and parent_id is not null)
  )
);

create unique index if not exists idx_feature_issues_one_epic_per_feature
  on feature_issues (feature_id)
  where type = 'epic' and parent_id is null;

create index if not exists idx_feature_issues_feature on feature_issues (feature_id);
create index if not exists idx_feature_issues_parent on feature_issues (parent_id) where parent_id is not null;

drop trigger if exists feature_issues_updated_at on feature_issues;
create trigger feature_issues_updated_at before update on feature_issues
  for each row execute function update_updated_at();

alter table feature_issues enable row level security;

drop policy if exists "feature_issues_select_own" on feature_issues;
drop policy if exists "feature_issues_insert_own" on feature_issues;
drop policy if exists "feature_issues_update_own" on feature_issues;
drop policy if exists "feature_issues_delete_own" on feature_issues;

create policy "feature_issues_select_own" on feature_issues for select to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_issues.feature_id and w.created_by = auth.uid()
    )
  );

create policy "feature_issues_insert_own" on feature_issues for insert to authenticated
  with check (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_id and w.created_by = auth.uid()
    )
  );

create policy "feature_issues_update_own" on feature_issues for update to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_issues.feature_id and w.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_id and w.created_by = auth.uid()
    )
  );

create policy "feature_issues_delete_own" on feature_issues for delete to authenticated
  using (
    exists (
      select 1 from features f
      join workspaces w on w.id = f.workspace_id
      where f.id = feature_issues.feature_id and w.created_by = auth.uid()
    )
  );
