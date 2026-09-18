-- Phase 3 setup: importing a real lender list.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.lenders
  add column if not exists lending_type text,
  add column if not exists min_revenue numeric,
  add column if not exists min_ebitda numeric,
  add column if not exists cares_about_profit boolean;

-- Lets the lender importer upsert by name (re-uploading an updated list
-- updates existing lenders instead of creating duplicates).
create unique index if not exists lenders_name_lower_key on public.lenders (lower(name));

create table if not exists public.lender_contacts (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references public.lenders (id) on delete cascade,
  name text,
  email text,
  created_at timestamptz not null default now()
);

alter table public.lender_contacts enable row level security;

drop policy if exists "lender_contacts: full access" on public.lender_contacts;
create policy "lender_contacts: full access" on public.lender_contacts
  for all to authenticated using (true) with check (true);
