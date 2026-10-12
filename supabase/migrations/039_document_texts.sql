-- Ask AI reads documents itself. The text of each document is pulled out
-- once and kept here, so searching a deal's files again is instant and free.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.

create table if not exists public.document_texts (
  document_id uuid primary key references public.documents (id) on delete cascade,
  page_count integer not null,
  pages text[] not null,
  -- 1-based page numbers with little or no text (scans) — read as images.
  scanned_pages integer[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.document_texts enable row level security;
drop policy if exists "document_texts: full access" on public.document_texts;
create policy "document_texts: full access" on public.document_texts for all to authenticated using (true) with check (true);
