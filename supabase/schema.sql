-- Dealflow CRM — full schema for a fresh install
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
-- (If you already have a database from an earlier version, run the files
-- under supabase/migrations/ in order instead.)

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

-- ── Deals ────────────────────────────────────────────────────────────────
create table if not exists public.deals (
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
  -- How actively this deal is being worked right now (0 = completely
  -- dormant, 10 = actively working it today) — separate from pipeline
  -- `status`.
  activity_score smallint check (activity_score between 0 and 10),
  deal_type text,
  -- Structured loan-type category (e.g. "ABL", "HELOC", "Real Estate
  -- Bridge") — distinct from deal_type, which is a free-text ask
  -- description. Used for the Pipeline filter and as a lender-matching
  -- signal.
  loan_type text,
  rep_name text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  underwriting jsonb,
  underwriting_generated_at timestamptz
);

drop trigger if exists deals_set_updated_at on public.deals;
create trigger deals_set_updated_at
  before update on public.deals
  for each row execute procedure public.set_updated_at();

-- ── Deal updates (a dated activity log per deal, not a single notes blob —
-- built to support daily manual entries and, later, entries the AI adds
-- from email threads) ──────────────────────────────────────────────────
create table if not exists public.deal_updates (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  entry_date date,
  note text not null,
  source text not null default 'manual',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ── Lenders ──────────────────────────────────────────────────────────────
create table if not exists public.lenders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  website text,
  mandate_notes text,
  lending_type text,
  min_loan_amount numeric,
  max_loan_amount numeric,
  min_revenue numeric,
  min_ebitda numeric,
  cares_about_profit boolean,
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

-- Lets the lender importer upsert by name (re-uploading an updated list
-- updates existing lenders instead of creating duplicates).
create unique index if not exists lenders_name_lower_key on public.lenders (lower(name));

-- ── Lender contacts (a lender company can have more than one contact) ────
create table if not exists public.lender_contacts (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references public.lenders (id) on delete cascade,
  name text,
  email text,
  created_at timestamptz not null default now()
);

-- ── Deal <-> lender match results (AI-scored) ────────────────────────────
create table if not exists public.deal_matches (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  lender_id uuid not null references public.lenders (id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  reasoning text not null,
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  -- Phase 4a: AI-drafted submission email, auto-generated for strong
  -- matches. Draft-only — "sent" is set later once an actual send path
  -- (e.g. pushing to Outlook) exists; nothing here sends email itself.
  draft_subject text,
  draft_body text,
  draft_status text not null default 'none'
    check (draft_status in ('none', 'drafted', 'sent')),
  draft_generated_at timestamptz
);

-- ── Documents (metadata; the file itself lives in Storage) ─────────────────
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
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
alter table public.deals enable row level security;
alter table public.deal_updates enable row level security;
alter table public.lenders enable row level security;
alter table public.lender_contacts enable row level security;
alter table public.deal_matches enable row level security;
alter table public.documents enable row level security;

drop policy if exists "profiles: read all" on public.profiles;
create policy "profiles: read all" on public.profiles
  for select to authenticated using (true);

drop policy if exists "deals: full access" on public.deals;
create policy "deals: full access" on public.deals
  for all to authenticated using (true) with check (true);

drop policy if exists "deal_updates: full access" on public.deal_updates;
create policy "deal_updates: full access" on public.deal_updates
  for all to authenticated using (true) with check (true);

drop policy if exists "lenders: full access" on public.lenders;
create policy "lenders: full access" on public.lenders
  for all to authenticated using (true) with check (true);

drop policy if exists "lender_contacts: full access" on public.lender_contacts;
create policy "lender_contacts: full access" on public.lender_contacts
  for all to authenticated using (true) with check (true);

drop policy if exists "deal_matches: full access" on public.deal_matches;
create policy "deal_matches: full access" on public.deal_matches
  for all to authenticated using (true) with check (true);

drop policy if exists "documents: full access" on public.documents;
create policy "documents: full access" on public.documents
  for all to authenticated using (true) with check (true);

-- ── Storage bucket for deal documents ────────────────────────────────────
-- (kept as "borrower-documents" internally — it's just a storage id no one
-- sees, and renaming it would mean migrating every already-uploaded file)
insert into storage.buckets (id, name, public)
values ('borrower-documents', 'borrower-documents', false)
on conflict (id) do nothing;

drop policy if exists "borrower-documents: authenticated access" on storage.objects;
create policy "borrower-documents: authenticated access" on storage.objects
  for all to authenticated
  using (bucket_id = 'borrower-documents')
  with check (bucket_id = 'borrower-documents');
