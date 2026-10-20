-- Lender matching: a "Don't match" switch per lender, and a flag for the
-- lenders added from research on Oct 5, 2026 that nobody at JED has worked
-- with yet (they only appear as "new lenders to try", and count as known
-- once a deal is sent to them or they email the team).
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.
alter table public.lenders add column if not exists match_excluded boolean not null default false;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lenders' and column_name = 'research_lead'
  ) then
    alter table public.lenders add column research_lead boolean not null default false;
    update public.lenders set research_lead = true where created_at::date = date '2026-10-05';
  end if;
end $$;
