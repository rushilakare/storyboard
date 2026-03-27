-- Issue metadata: due dates, provenance, richer status/priority (run after feature_issues exists).

alter table feature_issues add column if not exists due_date date;
alter table feature_issues add column if not exists generated_from text;

alter table feature_issues drop constraint if exists feature_issues_generated_from_check;
alter table feature_issues add constraint feature_issues_generated_from_check
  check (
    generated_from is null
    or generated_from in ('inference_competitor', 'manual', 'prd_import')
  );

alter table feature_issues drop constraint if exists feature_issues_status_check;
alter table feature_issues add constraint feature_issues_status_check check (
  status in (
    'open',
    'in_progress',
    'in_review',
    'done',
    'blocked',
    'cancelled'
  )
);

alter table feature_issues drop constraint if exists feature_issues_priority_check;
alter table feature_issues add constraint feature_issues_priority_check check (
  priority in ('lowest', 'low', 'medium', 'high', 'highest')
);
