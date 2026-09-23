-- AI triage of uploaded documents: which pages actually matter for
-- underwriting. Run once in Supabase (SQL Editor -> New query -> paste -> Run).

alter table public.documents
  add column if not exists triage jsonb,
  add column if not exists triaged_at timestamptz;
