-- Outreach prospects (CFOs/owners from the ABL Advisor + Apollo lists).
-- The inbox sync marks them Emailed when you write to them, and sorts their
-- replies: interested -> a new deal, not interested -> marked, auto-replies
-- -> ignored.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  company_display text,
  first_name text,
  last_name text,
  title text,
  email text not null unique,          -- stored lowercase
  phone text,
  linkedin text,
  city text,
  state text,
  website text,
  domain text,                         -- company email domain, for matching replies
  lender text,                         -- their existing facility (from ABL Advisor)
  amount text,
  deal_year text,
  source text,                         -- which list, e.g. "ABL Advisor 2021-2022"
  status text not null default 'new'
    check (status in ('new', 'emailed', 'replied', 'interested', 'not_interested', 'wrong_person', 'deal', 'do_not_contact')),
  last_emailed_at timestamptz,
  replied_at timestamptz,
  reply_summary text,
  deal_id uuid references public.deals (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prospects_domain_idx on public.prospects (domain);
create index if not exists prospects_status_idx on public.prospects (status);

alter table public.prospects enable row level security;
drop policy if exists "prospects: full access" on public.prospects;
create policy "prospects: full access" on public.prospects for all to authenticated using (true) with check (true);
