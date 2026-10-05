-- Lets each team member connect their own Outlook: one row per mailbox,
-- each with its own inbox-reading progress. Emails sent to more than one
-- connected mailbox are recognized by their Internet Message-ID so they're
-- only processed once.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.outlook_connections
  add column if not exists last_synced_at timestamptz;

-- Carry over the existing (Eli's) inbox progress.
update public.outlook_connections
set last_synced_at = (select last_synced_at from public.inbox_sync_state where id = 1)
where last_synced_at is null;

create unique index if not exists outlook_connections_account_email_key
  on public.outlook_connections (lower(account_email));

alter table public.inbox_messages
  add column if not exists internet_message_id text,
  add column if not exists mailbox text;

create index if not exists inbox_messages_internet_message_id_idx
  on public.inbox_messages (internet_message_id);
