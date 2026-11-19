-- Updated versions of the same document (a P&L re-sent with another month
-- added). When two files on a deal share a name but not a size, the AI
-- compares them: if one is a newer version of the other, the older one is
-- marked replaced (kept, never deleted) and the AI stops reading it.
-- Run this in Supabase (SQL Editor -> New query -> paste -> Run). Safe to
-- run again.

alter table public.documents add column if not exists replaced_by uuid references public.documents (id) on delete set null;
-- Set on a file once it has been compared with the earlier files of the same name.
alter table public.documents add column if not exists versions_checked_at timestamptz;
