-- NDAs, as a heads-up (never a block): a deal can be marked "lenders must
-- sign an NDA" (e.g. Team Inc), and each lender shows whether it has —
-- either JED's master NDA (covers every deal) or one for this deal only.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.

alter table public.deals add column if not exists requires_nda boolean not null default false;
alter table public.lenders add column if not exists nda_signed_on date;
alter table public.deal_submissions add column if not exists nda_signed_on date;
