-- Lender matches grouped the way the team reads them: best fits, good
-- options, long shots — with a one-line reason each.
alter table public.deal_matches add column if not exists tier text;
alter table public.deal_matches add column if not exists summary text;
