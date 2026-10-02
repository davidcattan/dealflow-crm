-- Which lenders a deal was actually sent to, with a status per lender and
-- per-lender notes. Kept separate from deal_matches so re-running the AI
-- matching never wipes this history.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run).

create table if not exists public.deal_submissions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  lender_id uuid not null references public.lenders (id) on delete cascade,
  status text not null default 'sent'
    check (status in ('sent', 'interested', 'needs_more_info', 'term_sheet', 'declined', 'funded')),
  sent_on date not null default current_date,
  outlook_conversation_id text,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (deal_id, lender_id)
);

alter table public.deal_submissions enable row level security;
drop policy if exists "deal_submissions: full access" on public.deal_submissions;
create policy "deal_submissions: full access" on public.deal_submissions
  for all to authenticated using (true) with check (true);

-- Lets an update belong to one lender on the deal.
alter table public.deal_updates
  add column if not exists lender_id uuid references public.lenders (id) on delete set null;

-- Backfill: every lender that already replied about a deal was sent it.
insert into public.deal_submissions (deal_id, lender_id, status, sent_on, last_activity_at)
select distinct on (deal_id, lender_id)
  deal_id,
  lender_id,
  case
    when summary like 'Interested:%' then 'interested'
    when summary like 'Needs more info:%' then 'needs_more_info'
    when summary like 'Term sheet%' then 'term_sheet'
    when summary like 'Declined:%' then 'declined'
    else 'sent'
  end,
  coalesce(received_at, now())::date,
  coalesce(received_at, now())
from public.inbox_messages
where classification = 'lender_reply' and deal_id is not null and lender_id is not null
order by deal_id, lender_id, received_at desc
on conflict (deal_id, lender_id) do nothing;

-- Carry over Outlook threads already started from the CRM.
update public.deal_submissions s
set outlook_conversation_id = m.outlook_conversation_id
from public.deal_matches m
where m.deal_id = s.deal_id and m.lender_id = s.lender_id
  and m.outlook_conversation_id is not null and s.outlook_conversation_id is null;
