-- Things the inbox reader finds in emails that need a person's yes or no:
-- new lenders someone referred, people it couldn't place, requests and
-- follow-ups that aren't tied to a deal. Shown on the To do page with
-- one-click Add / Dismiss. Each finding is only ever raised once, so a
-- dismissed one doesn't come back.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.

create table if not exists public.email_findings (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('new_lender', 'new_contact', 'lender_request', 'follow_up', 'possible_deal')),
  status text not null default 'open' check (status in ('open', 'added', 'dismissed')),
  title text not null,
  detail text,
  firm text,
  people jsonb not null default '[]'::jsonb,
  deal_id uuid references public.deals (id) on delete set null,
  lender_id uuid references public.lenders (id) on delete set null,
  source_from text,
  source_subject text,
  graph_message_id text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists email_findings_open_idx on public.email_findings (status, created_at desc);

alter table public.email_findings enable row level security;

drop policy if exists "email_findings: full access" on public.email_findings;
create policy "email_findings: full access" on public.email_findings
  for all to authenticated using (true) with check (true);
