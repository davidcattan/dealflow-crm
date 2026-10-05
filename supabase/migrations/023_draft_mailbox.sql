-- Remembers which mailbox an Outlook draft was created in, so the CRM can
-- spot it in that mailbox's Sent Items once it's sent.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.deal_matches
  add column if not exists outlook_draft_connection_id uuid;
