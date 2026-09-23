-- Adds an "old" deal status: deals that are stale / not being worked but
-- aren't really "dead". Run once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.deals drop constraint if exists deals_status_check;
alter table public.deals
  add constraint deals_status_check
  check (status in ('new', 'in_review', 'underwritten', 'matched', 'submitted', 'closed', 'dead', 'old'));
