-- Files on a lender's profile: tear sheets, term sheets, program guides.
-- Each one is read once and the lender's profile is filled in from it
-- (lending type, loan sizes, what they lend on, regions), so matching knows
-- what kind of lender they are.
create table if not exists public.lender_documents (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references public.lenders (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  file_size bigint,
  content_type text,
  -- What the AI read off it, and what it changed on the profile.
  summary text,
  changes jsonb not null default '[]'::jsonb,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lender_documents_lender_idx on public.lender_documents (lender_id, created_at desc);

alter table public.lender_documents enable row level security;

drop policy if exists "lender_documents: full access" on public.lender_documents;
create policy "lender_documents: full access" on public.lender_documents
  for all to authenticated using (true) with check (true);
