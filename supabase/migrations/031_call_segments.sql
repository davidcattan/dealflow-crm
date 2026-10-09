-- A recording that was interrupted and continued is saved in pieces; they're
-- transcribed separately and joined in order. Run this in Supabase (SQL
-- Editor -> New query -> paste -> Run). Safe to run again.

alter table public.deal_calls add column if not exists extra_paths jsonb not null default '[]'::jsonb;
alter table public.deal_calls add column if not exists transcript_job_ids jsonb not null default '[]'::jsonb;
