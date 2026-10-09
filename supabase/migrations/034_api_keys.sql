-- Personal keys for the iPhone "Send to JED CRM" shortcut (one per person;
-- only a hash is stored). Run this in Supabase (SQL Editor -> New query ->
-- paste -> Run). Safe to run again.

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.api_keys enable row level security;
drop policy if exists "api_keys: own rows" on public.api_keys;
create policy "api_keys: own rows" on public.api_keys for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
