-- A log of every inbox check (automatic or manual) so the CRM can show
-- whether the 30-minute automatic check is actually running.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

create table if not exists public.inbox_sync_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('auto', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  processed integer not null default 0,
  summary text,
  error text
);

create index if not exists inbox_sync_runs_started_at_idx on public.inbox_sync_runs (started_at desc);

alter table public.inbox_sync_runs enable row level security;
drop policy if exists "inbox_sync_runs: full access" on public.inbox_sync_runs;
create policy "inbox_sync_runs: full access" on public.inbox_sync_runs
  for all to authenticated using (true) with check (true);
