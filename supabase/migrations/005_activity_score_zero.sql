-- The real pipeline data uses 0 as a distinct "completely cold/dormant"
-- value, colder than 1 — widen the range to allow it.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.deals drop constraint if exists deals_activity_score_check;
alter table public.deals
  add constraint deals_activity_score_check check (activity_score between 0 and 10);
