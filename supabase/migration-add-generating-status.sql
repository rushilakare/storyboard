-- Run once on existing Supabase projects that already created `features` with the old check constraint.
-- Dashboard → SQL Editor → paste and run.

alter table features drop constraint if exists features_status_check;

alter table features
  add constraint features_status_check
  check (status in ('draft', 'in_progress', 'review', 'generating', 'done'));
