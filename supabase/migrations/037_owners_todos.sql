-- Each person's To do list: who's on each deal, plus to-dos you write
-- yourself ("call Mike about the appraisal").
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.

-- Whose deal it is: 'David', 'Eli', or empty = both.
alter table public.deals add column if not exists owner text;
update public.deals set owner = 'Eli' where owner is null and rep_name ilike 'eli%';
update public.deals set owner = 'David' where owner is null and rep_name ilike 'david%';

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  -- 'David' or 'Eli'
  assignee text not null,
  deal_id uuid references public.deals (id) on delete cascade,
  due_date date,
  done_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists todos_open_idx on public.todos (assignee, done_at);

alter table public.todos enable row level security;
drop policy if exists "todos: full access" on public.todos;
create policy "todos: full access" on public.todos for all to authenticated using (true) with check (true);
