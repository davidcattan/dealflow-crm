-- Stores the Microsoft OAuth connection used to create Outlook drafts.
-- One row expected (the team's single connected mailbox, e.g. Eli's).
-- The refresh token is the only long-lived secret; access tokens are
-- fetched on demand and never stored.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

create table if not exists public.outlook_connections (
  id uuid primary key default gen_random_uuid(),
  account_email text not null,
  refresh_token text not null,
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outlook_connections enable row level security;
create policy "outlook_connections: full access" on public.outlook_connections
  for all to authenticated using (true) with check (true);

alter table public.deal_matches
  add column if not exists outlook_draft_created_at timestamptz;
