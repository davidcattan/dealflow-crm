-- Document groups on a deal (bank statements, tax returns, term sheets…).
-- The CRM picks a group from the file name; these hold a group someone
-- chose by hand, and which lender a term sheet is from. Run this in
-- Supabase (SQL Editor -> New query -> paste -> Run). Safe to run again.

alter table public.documents add column if not exists category text;
alter table public.documents add column if not exists lender_id uuid references public.lenders (id) on delete set null;
