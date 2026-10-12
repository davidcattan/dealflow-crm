-- "Quick read": a short AI take on a deal (what it is, key numbers, top
-- watch-outs, what's missing, which lenders fit). Run this in Supabase
-- (SQL Editor -> New query -> paste -> Run). Safe to run again.

alter table public.deals add column if not exists quick_read jsonb;
alter table public.deals add column if not exists quick_read_at timestamptz;
