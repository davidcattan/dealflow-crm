-- Phase 4a: AI-drafted submission emails for strong lender matches.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.deal_matches
  add column if not exists draft_subject text,
  add column if not exists draft_body text,
  add column if not exists draft_status text not null default 'none'
    check (draft_status in ('none', 'drafted', 'sent')),
  add column if not exists draft_generated_at timestamptz;
