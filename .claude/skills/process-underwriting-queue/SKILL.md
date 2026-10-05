---
name: process-underwriting-queue
description: Underwrite the deals queued in the Dealflow CRM ("Queue for Claude Code" button) by reading their documents directly and saving the result back to the CRM — no paid Anthropic API calls. Use when the user says "process the underwriting queue", "run the queue", or asks to underwrite queued deals.
---

# Process the underwriting queue

Deals get queued from a deal page ("Underwrite for free → Queue for Claude Code"). The queue lives in the CRM's shared database, so it doesn't matter which team member queued a deal or whose Claude Code processes it. You do the reading and analysis yourself, on the user's Claude plan — the app makes no API call, so this costs $0 in API charges.

## Requirements

- A browser (the built-in browser pane, or Claude in Chrome) **logged into the live CRM**: https://dealflow-crm-gamma.vercel.app. If you hit the login page, ask the user to sign in — never type their password. All API calls below run from that logged-in page (JavaScript `fetch`), so they carry the user's session.
- Run from this repo (`crm/`) so the local `node_modules` (mupdf, mailparser) are available for reading files.

## Steps

1. **Fetch the queue** from the logged-in page:
   ```js
   await (await fetch('/api/queue')).json()
   ```
   Each entry has the deal fields, `underwriting_requested_kind` (`'snapshot'` — the default — or `'report'`), recent `updates`, `emails` (full text of emails the inbox filed on the deal — read these: borrowers often put values, budgets and plans in the email body rather than an attachment), and `documents` with a signed download `url` (valid ~1 hour) and any AI `triage` (doc type, important page ranges, summary). If the queue is empty, say so and stop.

2. **Download and read every document** (save to the session scratchpad, not the repo):
   - **PDF**: try text extraction with mupdf first. Many financial PDFs (QuickBooks exports, scans) have broken embedded fonts and extract as garbage — if so, **render pages to PNG with mupdf and read them visually** (Read tool on the image). Use the triage page ranges to skip boilerplate on long PDFs. The script must live inside `crm/` so `import * as mupdf from 'mupdf'` resolves; delete it afterward.
   - **.docx**: `python3 -c "import docx"` — read tables with python-docx (debt schedules are usually tables).
   - **.eml**: parse with `mailparser` (`simpleParser`) from a script inside `crm/`.
   - **.xlsx / .csv**: exceljs (in `crm/node_modules`) or plain text.

3. **Write the result** in the exact schema for the requested kind:
   - `snapshot` → `src/lib/snapshot/schema.ts` (`SnapshotSchema`). Follow the rules in `src/lib/snapshot/prompt.ts` (`SNAPSHOT_RULES`): one block per legal entity plus a combined block if there's more than one; three periods newest first with a source on every figure; EBITDA = net income + interest + depreciation/amortization (+ taxes); coverage = annual debt service vs EBITDA; short flags; a request list of only what's actually missing.
   - `report` → `src/lib/underwriting/schema.ts` (`UnderwritingSchema`). This one also includes web research: verify the company's identity (same name, location, industry) before trusting any search result, and say plainly when nothing relevant is found.
   - **Never invent a number.** Anything not in the documents is `null`. Cross-check totals (e.g. sum the debt schedule yourself and compare to the balance sheet) and flag mismatches.

4. **Save it** from the logged-in page — this clears the deal from the queue and moves it to Underwritten:
   ```js
   await fetch(`/api/deals/${dealId}/save-snapshot`, {      // or /save-underwriting for 'report'
     method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result),
   })
   ```
   A 400 response means the JSON didn't match the schema — the response lists the issues; fix and resend.

5. **Verify**: reload the deal page and confirm the snapshot/report shows, then fetch `/api/queue` again to confirm the deal left the queue.

6. **Report back** in plain language: what was underwritten, the headline numbers (revenue, EBITDA, total debt, coverage), and the most important flags.
