-- Adds a free-text description to deals: the broker's rundown of the deal.
-- Fed to the AI underwriting, matching, and email drafting.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.deals
  add column if not exists description text;
