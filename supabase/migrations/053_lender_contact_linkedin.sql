-- The people at each lender, not just the firm: what each person is the
-- right contact for (e.g. "Healthcare cash flow, middle market"), where we
-- stand with them on LinkedIn, and what they've told us. Matching reads
-- this to name who to send a deal to.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.

alter table public.lender_contacts add column if not exists covers text;
alter table public.lender_contacts add column if not exists linkedin_url text;
-- request_sent | connected | messaged | replied | not_accepted
alter table public.lender_contacts add column if not exists linkedin_status text;
alter table public.lender_contacts add column if not exists notes text;
alter table public.lender_contacts add column if not exists last_touch date;
