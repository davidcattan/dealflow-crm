-- Keeps the full text of deal-related emails (new deals, follow-ups, lender
-- replies) so it shows on the deal and feeds underwriting — the short AI
-- summary alone loses details like values and budgets.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.inbox_messages
  add column if not exists body_text text;
