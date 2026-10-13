-- More than one person on a deal (e.g. Team Inc: Clinton the CFO and
-- Charles the treasurer). The deal's own contact stays the main one; these
-- are the others. Emails from any of them land on the deal.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.

create table if not exists public.deal_contacts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists deal_contacts_deal_idx on public.deal_contacts (deal_id);
create index if not exists deal_contacts_email_idx on public.deal_contacts (lower(email));

alter table public.deal_contacts enable row level security;
drop policy if exists "deal_contacts: full access" on public.deal_contacts;
create policy "deal_contacts: full access" on public.deal_contacts for all to authenticated using (true) with check (true);
