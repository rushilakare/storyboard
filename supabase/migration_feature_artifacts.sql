-- Apply to an existing database that already has feature_messages (run after schema baseline).
-- Then run backfill_prd_to_feature_artifacts.sql and rls-policies.sql (feature_artifacts section).

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

create index if not exists idx_feature_artifacts_feature_kind_version on feature_artifacts (feature_id, kind, version desc);
create index if not exists idx_feature_artifacts_feature_draft on feature_artifacts (feature_id, kind) where is_draft = true;

drop trigger if exists feature_artifacts_updated_at on feature_artifacts;
create trigger feature_artifacts_updated_at before update on feature_artifacts
  for each row execute function update_updated_at();
