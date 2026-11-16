-- Web research on new lenders. A lender added automatically from email is
-- queued (research_requested_at) for the free Claude Code queue job, which
-- looks the firm up online and fills in what it lends on. researched_at
-- records when that last happened.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.

alter table public.lenders add column if not exists research_requested_at timestamptz;
alter table public.lenders add column if not exists researched_at timestamptz;

-- Queue the lenders already added from email history (Nov 16 2026).
update public.lenders
set research_requested_at = now()
where researched_at is null
  and research_requested_at is null
  and (mandate_notes like '%Added from email history%' or mandate_notes like '%Added automatically from email%');
