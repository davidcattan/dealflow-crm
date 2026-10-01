-- Keeps the AI's loan-type recommendation (the type + its explanation) on
-- the deal so the explanation is still there after leaving the page.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.deals
  add column if not exists loan_type_recommendation jsonb;
