# Dealflow CRM

Internal CRM for deal/lender matching. Phase 1: deal & lender records,
team logins, per-deal document storage, and an active-deal pipeline
tracker. Phase 2: AI underwriting. Lender matching and Outlook drafting come
in later phases.

## Stack

- Next.js (App Router) — app framework
- Supabase — database, auth (team logins), and private file storage
- Anthropic Claude API — AI underwriting (reads documents, the company
  website, and web search for news)
- Tailwind CSS — styling

## First-time setup

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard, go to **SQL Editor → New query**, paste the
   contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This
   creates all the tables, security rules, and the document storage bucket.
   If you already ran this once before, instead run each file under
   [`supabase/migrations/`](supabase/migrations/) in order — they're
   incremental updates to an existing database.
3. In **Project Settings → API**, copy the **Project URL** and **anon public**
   key.
4. Create an API key at [console.anthropic.com](https://console.anthropic.com)
   (Settings → API Keys) for AI underwriting. This is billed per use by
   Anthropic, separate from Supabase/Vercel.
5. Copy `.env.local.example` to `.env.local` and fill in those three values.
6. Run `npm install` then `npm run dev`, and open http://localhost:3000.
7. To add a team member: **Authentication → Users → Add user** in the
   Supabase dashboard (invite by email). There is no public sign-up page —
   accounts are created by an admin only.

## Deploying

Push this repo to GitHub, import it in [Vercel](https://vercel.com/new), and
add the same two environment variables from `.env.local` in the Vercel
project settings.
