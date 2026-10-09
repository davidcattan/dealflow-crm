-- Calls can also belong to a lender (e.g. an intro call with a new lender)
-- instead of a deal. Run this in Supabase (SQL Editor -> New query ->
-- paste -> Run). Safe to run again.

alter table public.deal_calls alter column deal_id drop not null;
alter table public.deal_calls drop constraint if exists deal_calls_has_owner;
alter table public.deal_calls add constraint deal_calls_has_owner check (deal_id is not null or lender_id is not null);
create index if not exists deal_calls_lender_idx on public.deal_calls (lender_id, created_at desc);
