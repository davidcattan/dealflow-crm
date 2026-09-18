-- Phase 2: AI underwriting storage.
-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run) if
-- your database already exists from schema.sql. Safe to re-run.

alter table public.borrowers
  add column if not exists underwriting jsonb,
  add column if not exists underwriting_generated_at timestamptz;
