-- Recorded phone / Teams / Zoom calls on a deal: the audio, its transcript,
-- and the AI's notes (summary, next steps, suggested updates).
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again if you ran an earlier version of it.

create table if not exists public.deal_calls (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  storage_path text not null,
  duration_seconds integer,
  -- uploaded -> transcribing -> summarizing -> done (or error)
  status text not null default 'uploaded'
    check (status in ('uploaded', 'transcribing', 'summarizing', 'done', 'error')),
  transcript_job_id text,
  transcript text,
  result jsonb,
  -- Keys of the suggested updates someone applied.
  applied jsonb not null default '[]'::jsonb,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deal_calls_deal_idx on public.deal_calls (deal_id, created_at desc);

alter table public.deal_calls enable row level security;
drop policy if exists "deal_calls: full access" on public.deal_calls;
create policy "deal_calls: full access" on public.deal_calls for all to authenticated using (true) with check (true);

-- Who the call was with, picked before recording (optional).
alter table public.deal_calls add column if not exists call_with text;
alter table public.deal_calls add column if not exists lender_id uuid references public.lenders (id) on delete set null;
