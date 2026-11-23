-- Standing instructions the team gives Ask AI ("never suggest ABL lenders
-- for a cash-flow deal", "CC Eli on lender emails"). Saved from the chat
-- with "Do it"; Ask AI reads them before every answer.
create table if not exists public.ai_team_rules (
  id uuid primary key default gen_random_uuid(),
  rule text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ai_team_rules enable row level security;
drop policy if exists "ai_team_rules: full access" on public.ai_team_rules;
create policy "ai_team_rules: full access" on public.ai_team_rules
  for all to authenticated using (true) with check (true);
