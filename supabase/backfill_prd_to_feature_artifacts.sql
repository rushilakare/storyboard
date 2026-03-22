-- One-time backfill: copy existing prd_documents into feature_artifacts (version 1, completed).
-- Run in Supabase SQL Editor after feature_artifacts exists.
-- Skips features that already have a prd artifact.

insert into feature_artifacts (
  feature_id,
  kind,
  mime_type,
  title,
  body,
  version,
  is_draft,
  metadata
)
select
  p.feature_id,
  'prd',
  'text/markdown',
  'PRD',
  p.content,
  1,
  false,
  '{}'::jsonb
from prd_documents p
where length(trim(p.content)) > 0
  and not exists (
    select 1
    from feature_artifacts fa
    where fa.feature_id = p.feature_id
      and fa.kind = 'prd'
  );
