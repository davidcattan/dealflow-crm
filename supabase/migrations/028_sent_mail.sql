-- Reading the Sent folder too: sent emails are recorded alongside inbox
-- emails (classification 'sent', with their recipients), and each mailbox
-- keeps its own Sent-folder progress (starting 2 days back).
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.inbox_messages drop constraint if exists inbox_messages_classification_check;
alter table public.inbox_messages add constraint inbox_messages_classification_check
  check (classification in ('new_deal', 'lender_reply', 'other', 'error', 'sent'));

alter table public.inbox_messages
  add column if not exists to_emails text;

alter table public.outlook_connections
  add column if not exists last_sent_synced_at timestamptz;

update public.outlook_connections
set last_sent_synced_at = now() - interval '2 days'
where last_sent_synced_at is null;
