-- Key facts per deal: the handful of things that matter for that kind of
-- deal (property address, value, liens… or revenue, AR, current lender…),
-- each with where it came from. Filled by the AI; anything you edit by hand
-- is kept when it refreshes.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.
alter table public.deals add column if not exists key_facts jsonb;
alter table public.deals add column if not exists key_facts_at timestamptz;
