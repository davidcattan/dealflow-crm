-- A researched first line for each cold email (their focus, a recent deal).
alter table public.prospects add column if not exists personal_line text;
