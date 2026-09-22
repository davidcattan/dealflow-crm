-- Adds a structured loan-type category to deals (e.g. "ABL", "HELOC",
-- "Real Estate Bridge", "Equipment Financing") — separate from the
-- free-text deal_type/ask field, and used both as a Pipeline column/filter
-- and as an extra signal for lender matching.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.deals
  add column if not exists loan_type text;
