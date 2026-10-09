-- Links the updates a recorded call adds to the deal back to that call, so
-- deleting the call removes them too. Run this in Supabase (SQL Editor ->
-- New query -> paste -> Run). Safe to run again.

alter table public.deal_updates
  add column if not exists call_id uuid references public.deal_calls (id) on delete cascade;
