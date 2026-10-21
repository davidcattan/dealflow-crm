-- Which version of the document reader produced each saved text. Version 2
-- reads fillable PDF form boxes, Word documents and scanned pages; texts
-- saved by version 1 are re-read once, the next time something reads them.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.
alter table public.document_texts add column if not exists reader_version integer not null default 1;
