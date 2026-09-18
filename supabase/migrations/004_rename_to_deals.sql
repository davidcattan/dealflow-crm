-- Phase 3 prep: rename "borrowers" to "deals" throughout, add fields for
-- the real pipeline import (activity score, deal type, rep name), and add
-- a proper dated Updates log instead of a single notes blob.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.borrowers rename to deals;
alter table public.documents rename column borrower_id to deal_id;

alter table public.deals
  add column if not exists activity_score smallint check (activity_score between 1 and 10),
  add column if not exists deal_type text,
  add column if not exists rep_name text;

alter policy "borrowers: full access" on public.deals rename to "deals: full access";
alter trigger borrowers_set_updated_at on public.deals rename to deals_set_updated_at;

create table if not exists public.deal_updates (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  entry_date date,
  note text not null,
  source text not null default 'import',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.deal_updates enable row level security;

drop policy if exists "deal_updates: full access" on public.deal_updates;
create policy "deal_updates: full access" on public.deal_updates
  for all to authenticated using (true) with check (true);
