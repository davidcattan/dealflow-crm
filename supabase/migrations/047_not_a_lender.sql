-- Firms on the lender list that aren't lenders (e.g. an advisor the team
-- works with): their emails aren't logged as lender replies or "Lenders
-- sent to", and they never come up in matching. Set from a lender note
-- ("they're advising us, not a lender") or the lender page.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.
alter table public.lenders add column if not exists is_lender boolean not null default true;
