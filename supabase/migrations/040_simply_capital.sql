-- Simply Capital application prep: the answers for his Jotform (pre-filled
-- link) and which of the deal's files go in the upload. Run this in
-- Supabase (SQL Editor -> New query -> paste -> Run). Safe to run again.

alter table public.deals add column if not exists simply_capital jsonb;
alter table public.deals add column if not exists simply_capital_at timestamptz;
