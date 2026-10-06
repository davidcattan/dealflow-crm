import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { snapshotToText } from '@/lib/snapshot/text'
import type { Snapshot } from '@/lib/snapshot/schema'
import { loadDealEmails, emailsToText } from '@/lib/deals/deal-emails'
import { loadNextSteps } from '@/lib/deals/load-next-steps'
import { SUBMISSION_LABELS, type SubmissionStatus } from '@/lib/deals/submission-status'
import type { DocumentRecord } from '@/lib/types'
import type { LenderSearch } from '@/lib/lender-search/schema'

export const CHAT_RULES = `You are the AI assistant inside Dealflow CRM, used by David and Eli Cattan at JED Capital Group, a New York commercial debt brokerage (asset-based, real estate and growth financing). They are brokers, not developers — talk to them like a sharp senior colleague: plain English, direct, practical.

How to work:
- Answer the question asked. Be concise; use short paragraphs or bullets. Explain your reasoning when it helps them decide, or when they ask.
- Use ONLY facts in the CRM data below (or in documents/emails they attach or paste). Never invent numbers, names or dates. When you state a key fact, say where it came from (e.g. "per the Mar 2026 appraisal", "per Gabby's email", "borrower's estimate"). If something isn't known, say so and suggest how to get it.
- Do the math for them when useful (LTV, coverage, totals) and show it briefly.
- If a full document would answer the question better than the summaries here, say which one and ask them to attach it with the 📎 button.

Writing emails:
- Put every email you draft in a fenced block starting with \`\`\`email and ending with \`\`\`, with "Subject: …" as the first line, then a blank line, then the body. Nothing else inside the block. This lets them copy it in one click.
- Emails to LENDERS are sales emails: lead with collateral, value, LTV, exit and why it fits that lender; ask for a call. Mention a weakness only if it decides whether that lender can do the deal, framed as structure with its mitigant. Never put internal diligence notes in a lender email (snapshot flags, overdrawn/drained accounts, $0 personal income, audits, missing documents, "not yet stated").
- Emails to BORROWERS asking for information: a one-line friendly opener, then a simple numbered list of plain questions — no section headers and no "Topic:" lead-ins — then a one-line close.
- Short, no filler ("I hope this finds you well"), no hype. Sign off "Best," and the sender's first name (David unless told otherwise).
- When they paste a lender's questionnaire, answer each item from the CRM data, mark what's unknown as [ask borrower], and list the questions to send the borrower.`

function fmtDate(iso: string | null | undefined) {
  return iso ? iso.slice(0, 10) : '—'
}

// Everything the assistant should know about one deal, as plain text.
export async function buildDealContext(supabase: SupabaseClient, dealId: string) {
  const [{ data: deal }, { data: docs }, { data: updates }, { data: subs }, { data: matches }, emails, steps] =
    await Promise.all([
      supabase.from('deals').select('*').eq('id', dealId).single(),
      supabase.from('documents').select('*').eq('deal_id', dealId).order('uploaded_at'),
      supabase
        .from('deal_updates')
        .select('entry_date, note, created_at')
        .eq('deal_id', dealId)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.from('deal_submissions').select('status, sent_on, last_activity_at, lenders(name)').eq('deal_id', dealId),
      supabase
        .from('deal_matches')
        .select('score, reasoning, draft_status, lenders(name, lending_type)')
        .eq('deal_id', dealId)
        .order('score', { ascending: false })
        .limit(10),
      loadDealEmails(supabase, dealId, 25),
      loadNextSteps(supabase, [dealId]),
    ])
  if (!deal) throw new Error('Deal not found')

  const name = (l: unknown) => ((Array.isArray(l) ? l[0] : l) as { name?: string } | null)?.name ?? 'Unknown lender'
  const step = steps.get(dealId)
  const lenderSearch = deal.lender_search as LenderSearch | null

  const parts = [
    `=== DEAL: ${deal.company_name} ===`,
    `Status: ${deal.status} | Industry: ${deal.industry ?? '—'} | Loan type: ${deal.loan_type ?? '—'} | Ask: ${deal.deal_type ?? '—'}`,
    `Contact: ${[deal.contact_name, deal.contact_email, deal.contact_phone].filter(Boolean).join(', ') || '—'} | Rep: ${deal.rep_name ?? '—'} | Added: ${fmtDate(deal.created_at)}`,
    deal.description ? `Description: ${deal.description}` : null,
    deal.notes ? `Notes: ${deal.notes}` : null,
    step ? `CRM's suggested next step: ${step.text}${step.detail ? ` (${step.detail})` : ''}` : null,
    deal.snapshot ? `\n--- Underwriting snapshot (internal) ---\n${snapshotToText(deal.snapshot as Snapshot)}` : '\n(No underwriting snapshot yet.)',
    `\n--- Lenders sent to ---\n${
      (subs ?? []).length
        ? (subs ?? [])
            .map((s) => `- ${name(s.lenders)}: ${SUBMISSION_LABELS[s.status as SubmissionStatus] ?? s.status} (sent ${fmtDate(s.sent_on)}, last activity ${fmtDate(s.last_activity_at)})`)
            .join('\n')
        : 'None yet.'
    }`,
    (matches ?? []).length
      ? `\n--- AI lender matches (top ${matches!.length}) ---\n${matches!
          .map((m) => `- ${name(m.lenders)} (${m.score}/100): ${m.reasoning}`)
          .join('\n')}`
      : null,
    lenderSearch?.results?.length
      ? `\n--- Lenders found online (not yet in the list unless added) ---\n${lenderSearch.results
          .map((r) => `- ${r.name} — ${r.lending_type}${r.loan_size ? `, ${r.loan_size}` : ''}${r.geographies ? `, ${r.geographies}` : ''}`)
          .join('\n')}`
      : null,
    `\n--- Documents (${(docs ?? []).length}) ---\n${
      ((docs ?? []) as DocumentRecord[])
        .map((d) => `- ${d.file_name}${d.triage ? ` — ${d.triage.doc_type}: ${d.triage.summary}` : ''}`)
        .join('\n') || 'None.'
    }`,
    `\n--- Updates log (newest first) ---\n${(updates ?? []).map((u) => `${u.entry_date ?? fmtDate(u.created_at)}: ${u.note}`).join('\n') || 'None.'}`,
    emails.length ? `\n${emailsToText(emails, 30000)}` : null,
  ]
  return { text: parts.filter(Boolean).join('\n'), documents: (docs ?? []) as DocumentRecord[], dealName: deal.company_name as string }
}

// For the assistant off a deal page: the active pipeline at a glance.
export async function buildPipelineContext(supabase: SupabaseClient) {
  const { data: deals } = await supabase
    .from('deals')
    .select('id, company_name, status, loan_type, deal_type, updated_at')
    .in('status', ['new', 'in_review', 'underwritten', 'matched', 'submitted'])
    .order('updated_at', { ascending: false })
    .limit(60)
  const steps = await loadNextSteps(supabase, (deals ?? []).map((d) => d.id))
  const { data: activity } = await supabase
    .from('notifications')
    .select('title, created_at')
    .order('created_at', { ascending: false })
    .limit(25)
  return [
    `=== ACTIVE PIPELINE (${(deals ?? []).length} deals) ===`,
    ...(deals ?? []).map((d) => {
      const s = steps.get(d.id)
      return `- ${d.company_name} [${d.status}] ${d.loan_type ?? ''} ${d.deal_type ? `— ${d.deal_type}` : ''} | next: ${s ? s.text : '—'} | updated ${fmtDate(d.updated_at)}`
    }),
    `\n--- Recent activity from email ---\n${(activity ?? []).map((a) => `${fmtDate(a.created_at)}: ${a.title}`).join('\n') || 'None.'}`,
    '\n(For details on one deal, open it — the assistant then sees the whole deal.)',
  ].join('\n')
}
