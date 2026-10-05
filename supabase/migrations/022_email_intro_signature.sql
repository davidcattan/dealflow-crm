-- Each person's intro paragraph and signature for lender emails, kept on
-- their connected mailbox and editable in Settings.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.outlook_connections
  add column if not exists email_intro text,
  add column if not exists email_signature text;
