-- Per-call log of AI usage and estimated cost, so spend is visible in-app.
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run).
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals (id) on delete set null,
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  web_searches integer not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage: full access" on public.ai_usage;
create policy "ai_usage: full access" on public.ai_usage
  for all to authenticated using (true) with check (true);
