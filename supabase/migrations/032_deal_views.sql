-- Who has opened which deal — so deals the inbox created show a
-- "New from email" tag on the Pipeline until you open them.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run).

create table if not exists public.deal_views (
  user_id uuid not null references auth.users (id) on delete cascade,
  deal_id uuid not null references public.deals (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, deal_id)
);

alter table public.deal_views enable row level security;
drop policy if exists "deal_views: own rows" on public.deal_views;
create policy "deal_views: own rows" on public.deal_views for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Everything already in the CRM counts as seen, so only new imports get tagged.
insert into public.deal_views (user_id, deal_id)
select u.id, d.id from auth.users u cross join public.deals d
on conflict do nothing;
