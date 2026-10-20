-- Each mailbox's own cold email for prospects (Settings -> Edit prospect
-- email). Empty = the standard email. {first_name} and {company} are filled
-- in per person.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.
alter table public.outlook_connections add column if not exists prospect_subject text;
alter table public.outlook_connections add column if not exists prospect_body text;
