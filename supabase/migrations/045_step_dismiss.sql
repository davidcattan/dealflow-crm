-- "Dismiss" on the To do page: hides a deal's current next step until
-- something new happens on the deal (then it comes back if still relevant).
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.
alter table public.deals add column if not exists step_dismissed text;
alter table public.deals add column if not exists step_dismissed_at timestamptz;
