-- Dealflow CRM — Phase 1 schema
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run

-- ── Profiles (one row per team member, auto-created on signup) ─────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'broker' check (role in ('admin', 'broker')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Shared updated_at helper ─────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Borrowers ────────────────────────────────────────────────────────────
create table if not exists public.borrowers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  industry text,
  website text,
  status text not null default 'new'
    check (status in ('new', 'in_review', 'underwritten', 'matched', 'submitted', 'closed', 'dead')),
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  underwriting jsonb,
  underwriting_generated_at timestamptz
);

drop trigger if exists borrowers_set_updated_at on public.borrowers;
create trigger borrowers_set_updated_at
  before update on public.borrowers
  for each row execute procedure public.set_updated_at();

-- ── Lenders ──────────────────────────────────────────────────────────────
create table if not exists public.lenders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  website text,
  mandate_notes text,
  min_loan_amount numeric,
  max_loan_amount numeric,
  asset_types text[] not null default '{}',
  industries text[] not null default '{}',
  geographies text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists lenders_set_updated_at on public.lenders;
create trigger lenders_set_updated_at
  before update on public.lenders
  for each row execute procedure public.set_updated_at();

-- ── Documents (metadata; the file itself lives in Storage) ─────────────────
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references public.borrowers (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  file_size bigint,
  content_type text,
  uploaded_by uuid references public.profiles (id),
  uploaded_at timestamptz not null default now()
);

-- ── Row Level Security ───────────────────────────────────────────────────
-- This is a shared team CRM: any signed-in team member (added by an admin
-- via the Supabase dashboard — there's no public sign-up) can read/write
-- all records.

alter table public.profiles enable row level security;
alter table public.borrowers enable row level security;
alter table public.lenders enable row level security;
alter table public.documents enable row level security;

drop policy if exists "profiles: read all" on public.profiles;
create policy "profiles: read all" on public.profiles
  for select to authenticated using (true);

drop policy if exists "borrowers: full access" on public.borrowers;
create policy "borrowers: full access" on public.borrowers
  for all to authenticated using (true) with check (true);

drop policy if exists "lenders: full access" on public.lenders;
create policy "lenders: full access" on public.lenders
  for all to authenticated using (true) with check (true);

drop policy if exists "documents: full access" on public.documents;
create policy "documents: full access" on public.documents
  for all to authenticated using (true) with check (true);

-- ── Storage bucket for borrower documents ───────────────────────────────
insert into storage.buckets (id, name, public)
values ('borrower-documents', 'borrower-documents', false)
on conflict (id) do nothing;

drop policy if exists "borrower-documents: authenticated access" on storage.objects;
create policy "borrower-documents: authenticated access" on storage.objects
  for all to authenticated
  using (bucket_id = 'borrower-documents')
  with check (bucket_id = 'borrower-documents');
