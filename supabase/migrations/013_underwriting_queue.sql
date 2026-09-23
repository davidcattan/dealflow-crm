-- Lets a deal be "queued" for underwriting by Claude Code (runs on the
-- Claude subscription instead of the paid API). Run once in Supabase
-- (SQL Editor -> New query -> paste -> Run).

alter table public.deals
  add column if not exists underwriting_requested_at timestamptz;
