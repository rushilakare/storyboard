-- LLM usage events per authenticated user (provider-reported tokens).
-- Run after schema.sql. Then append policies from rls-policies.sql (ai_usage_events section).

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

create index if not exists idx_ai_usage_events_user_created
  on ai_usage_events (user_id, created_at desc);

create index if not exists idx_ai_usage_events_user_model
  on ai_usage_events (user_id, model_id);

alter table ai_usage_events enable row level security;

drop policy if exists "ai_usage_events_select_own" on ai_usage_events;
drop policy if exists "ai_usage_events_insert_own" on ai_usage_events;

create policy "ai_usage_events_select_own" on ai_usage_events for select to authenticated
  using (user_id = auth.uid());

create policy "ai_usage_events_insert_own" on ai_usage_events for insert to authenticated
  with check (user_id = auth.uid());
