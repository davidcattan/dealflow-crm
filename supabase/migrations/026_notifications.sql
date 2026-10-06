-- Activity feed: one row for every change an email caused (new deal,
-- deal follow-up, lender reply, sent submission, something to review),
-- plus when each person last looked, for their unread count.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('new_deal', 'deal_update', 'lender_reply', 'sent', 'needs_review')),
  title text not null,
  body text,
  deal_id uuid references public.deals (id) on delete cascade,
  lender_id uuid references public.lenders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists notifications_created_at_idx on public.notifications (created_at desc);

alter table public.notifications enable row level security;
drop policy if exists "notifications: full access" on public.notifications;
create policy "notifications: full access" on public.notifications
  for all to authenticated using (true) with check (true);

create table if not exists public.notification_seen (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.notification_seen enable row level security;
drop policy if exists "notification_seen: own row" on public.notification_seen;
create policy "notification_seen: own row" on public.notification_seen
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Start the feed with the last 7 days of email activity.
insert into public.notifications (kind, title, body, deal_id, lender_id, created_at)
select
  case
    when m.classification = 'new_deal' and m.action_taken like 'Created deal%' then 'new_deal'
    when m.classification = 'new_deal' then 'deal_update'
    when m.classification = 'lender_reply' and m.deal_id is not null then 'lender_reply'
    else 'needs_review'
  end,
  case
    when m.classification = 'new_deal' and m.action_taken like 'Created deal%' then 'New deal: ' || coalesce(d.company_name, 'a deal')
    when m.classification = 'new_deal' then 'Deal updated: ' || coalesce(d.company_name, 'a deal')
    when m.classification = 'lender_reply' and m.deal_id is not null then coalesce(l.name, m.from_email) || ' replied on ' || coalesce(d.company_name, 'a deal')
    when m.classification = 'lender_reply' then 'Lender reply needs a deal: ' || coalesce(l.name, m.from_email)
    else 'Couldn''t process an email from ' || coalesce(m.from_email, 'someone')
  end,
  left(coalesce(m.summary, '') || case when m.action_taken is not null then ' (' || m.action_taken || ')' else '' end, 1000),
  m.deal_id,
  m.lender_id,
  coalesce(m.received_at, m.created_at)
from public.inbox_messages m
left join public.deals d on d.id = m.deal_id
left join public.lenders l on l.id = m.lender_id
where coalesce(m.received_at, m.created_at) > now() - interval '7 days'
  and m.classification in ('new_deal', 'lender_reply', 'error')
  and not exists (select 1 from public.notifications);
