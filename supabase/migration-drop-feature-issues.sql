-- Remove legacy issues/backlog table (run once in Supabase SQL editor if feature_issues exists).

drop policy if exists "feature_issues_select_own" on feature_issues;
drop policy if exists "feature_issues_insert_own" on feature_issues;
drop policy if exists "feature_issues_update_own" on feature_issues;
drop policy if exists "feature_issues_delete_own" on feature_issues;

drop trigger if exists feature_issues_updated_at on feature_issues;

drop index if exists idx_feature_issues_one_epic_per_feature;
drop index if exists idx_feature_issues_feature;
drop index if exists idx_feature_issues_parent;

drop table if exists feature_issues;