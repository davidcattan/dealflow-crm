-- Inbox reading: every processed email is recorded once (dedupe + audit
-- trail of what the AI decided and did), plus a single sync-state row.
-- Auto-sync starts OFF; it's turned on from Settings after a supervised
-- manual run. Run once in Supabase (SQL Editor -> New query -> paste -> Run).

create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  graph_message_id text not null unique,
  conversation_id text,
  from_email text,
  subject text,
  received_at timestamptz,
  classification text not null check (classification in ('new_deal', 'lender_reply', 'other', 'error')),
  deal_id uuid references public.deals (id) on delete set null,
  lender_id uuid references public.lenders (id) on delete set null,
  summary text,
  action_taken text,
  created_at timestamptz not null default now()
);

create table if not exists public.inbox_sync_state (
  id int primary key default 1 check (id = 1),
  auto_sync_enabled boolean not null default false,
  last_synced_at timestamptz,
  last_run_at timestamptz,
  last_run_status text,
  last_error text
);
insert into public.inbox_sync_state (id) values (1) on conflict (id) do nothing;

alter table public.inbox_messages enable row level security;
alter table public.inbox_sync_state enable row level security;
create policy "inbox_messages: full access" on public.inbox_messages
  for all to authenticated using (true) with check (true);
create policy "inbox_sync_state: full access" on public.inbox_sync_state
  for all to authenticated using (true) with check (true);

-- Lets a lender's reply be matched back to the exact deal + lender it
-- answers (Outlook keeps the same conversation id across a thread).
alter table public.deal_matches
  add column if not exists outlook_conversation_id text;

-- Deals created automatically from an email.
alter table public.deals
  add column if not exists source_message_id text;
