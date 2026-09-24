-- Lender snapshot: a short, template-based summary (per entity + combined)
-- stored alongside (not replacing) the older research-report underwriting.
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.deals
  add column if not exists snapshot jsonb,
  add column if not exists snapshot_generated_at timestamptz,
  add column if not exists underwriting_requested_kind text;
