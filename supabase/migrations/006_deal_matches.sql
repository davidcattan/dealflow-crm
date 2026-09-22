-- Phase 3: lender matching results.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

create table if not exists public.deal_matches (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  lender_id uuid not null references public.lenders (id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  reasoning text not null,
  selected boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.deal_matches enable row level security;

drop policy if exists "deal_matches: full access" on public.deal_matches;
create policy "deal_matches: full access" on public.deal_matches
  for all to authenticated using (true) with check (true);
