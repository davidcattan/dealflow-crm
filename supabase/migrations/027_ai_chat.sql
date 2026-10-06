-- "Ask AI" conversations. Deal conversations are shared by the team;
-- general (no deal) ones belong to whoever started them.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

create table if not exists public.ai_chats (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_chats_deal_idx on public.ai_chats (deal_id, updated_at desc);

create table if not exists public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.ai_chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  attached text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_chat_messages_chat_idx on public.ai_chat_messages (chat_id, created_at);

alter table public.ai_chats enable row level security;
alter table public.ai_chat_messages enable row level security;
drop policy if exists "ai_chats: full access" on public.ai_chats;
create policy "ai_chats: full access" on public.ai_chats for all to authenticated using (true) with check (true);
drop policy if exists "ai_chat_messages: full access" on public.ai_chat_messages;
create policy "ai_chat_messages: full access" on public.ai_chat_messages for all to authenticated using (true) with check (true);
