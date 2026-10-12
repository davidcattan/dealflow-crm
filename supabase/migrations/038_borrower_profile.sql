-- Borrower profile: owner and company details for lender application forms
-- (legal name, EIN, owners, percentages, addresses…), pulled from a deal's
-- tax returns and entity papers. Never stores Social Security numbers.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.

alter table public.deals add column if not exists borrower_profile jsonb;
alter table public.deals add column if not exists borrower_profile_at timestamptz;
