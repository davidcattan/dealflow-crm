# Dealflow CRM

Internal CRM for borrower/lender matching. Phase 1: borrower & lender records,
team logins, and per-borrower document storage. AI underwriting, matching,
and Outlook drafting come in later phases.

## Stack

- Next.js (App Router) — app framework
- Supabase — database, auth (team logins), and private file storage
- Tailwind CSS — styling

## First-time setup

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard, go to **SQL Editor → New query**, paste the
   contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This
   creates all the tables, security rules, and the document storage bucket.
3. In **Project Settings → API**, copy the **Project URL** and **anon public**
   key.
4. Copy `.env.local.example` to `.env.local` and fill in those two values.
5. Run `npm install` then `npm run dev`, and open http://localhost:3000.
6. To add a team member: **Authentication → Users → Add user** in the
   Supabase dashboard (invite by email). There is no public sign-up page —
   accounts are created by an admin only.

## Deploying

Push this repo to GitHub, import it in [Vercel](https://vercel.com/new), and
add the same two environment variables from `.env.local` in the Vercel
project settings.
