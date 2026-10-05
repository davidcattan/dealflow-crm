-- "Find new lenders online": the latest web search results for a deal, and
-- a flag for running it free through Claude Code.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.deals
  add column if not exists lender_search jsonb,
  add column if not exists lender_search_generated_at timestamptz,
  add column if not exists lender_search_requested_at timestamptz;
