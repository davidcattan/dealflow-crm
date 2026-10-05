-- More than one contact per lender, each with a role, phone, and whether
-- to CC them on submission emails.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.lender_contacts
  add column if not exists title text,
  add column if not exists phone text,
  add column if not exists cc_on_emails boolean not null default false;
