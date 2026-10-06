import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { snapshotToText } from '@/lib/snapshot/text'
import type { Snapshot } from '@/lib/snapshot/schema'
import type { DocumentRecord } from '@/lib/types'

const MAX_OUTLOOK_BYTES = 3 * 1024 * 1024

const RecommendationSchema = z.object({
  documents: z.array(
    z.object({
      ref: z.string().describe('The document ref, e.g. "F3".'),
      include: z.boolean(),
      reason: z.string().describe('A few words: why include or skip, e.g. "latest 3 months", "duplicate of F4", "internal trust paperwork".'),
    })
  ),
  note: z.string().nullable().describe('One short line on anything missing that a lender will ask for, or null.'),
})

const INSTRUCTIONS = `You are a commercial debt broker choosing which documents to attach to a first submission email to lenders. Lenders want a tight, relevant package — not everything the borrower sent.

Decide include/skip for EVERY document, with a few-word reason. Guidelines:
- Include what a lender needs to decide whether to look further: appraisal / valuation, the most recent financial statements or tax returns, the most recent 2–3 months of bank statements per account, debt schedule, AR/AP aging (for ABL), equipment lists (for equipment loans), purchase contract / budget / site plan (for real estate and construction), entity formation documents when the borrower is an unusual entity (nonprofit, trust).
- Skip duplicates (same account and period), older bank statements beyond the latest 3 months per account, near-empty or dormant accounts, internal paperwork (powers of attorney, releases, trust agreements) unless the deal specifically depends on them, and anything personal that isn't needed (e.g. a spouse's unrelated documents).
- Skip files marked "over 3MB" — Outlook can't attach them; say so in the reason.
- Aim for roughly 5–10 documents unless the deal truly needs more.`

export async function recommendAttachments(supabase: SupabaseClient, dealId: string) {
  const [{ data: deal }, { data: docs }] = await Promise.all([
    supabase.from('deals').select('company_name, loan_type, deal_type, description, snapshot').eq('id', dealId).single(),
    supabase.from('documents').select('*').eq('deal_id', dealId).order('uploaded_at', { ascending: true }),
  ])
  if (!deal) throw new Error('Deal not found')
  const documents = (docs ?? []) as DocumentRecord[]
  if (documents.length === 0) throw new Error('This deal has no documents yet.')

  const refs = documents.map((d, i) => ({ ref: `F${i + 1}`, doc: d }))
  const list = refs
    .map(({ ref, doc }) => {
      const t = doc.triage
      const size = (doc.file_size ?? 0) > MAX_OUTLOOK_BYTES ? ' [over 3MB]' : ''
      return `${ref}: ${doc.file_name}${size}${t ? ` — ${t.doc_type}; ${t.total_pages} pages; relevance ${t.relevance}; ${t.summary}` : ''}`
    })
    .join('\n')

  const snapshot = deal.snapshot as Snapshot | null
  const content = [
    `Deal: ${deal.company_name}`,
    deal.loan_type ? `Loan type: ${deal.loan_type}` : null,
    deal.deal_type ? `Ask: ${deal.deal_type}` : null,
    deal.description ? `Description: ${deal.description}` : null,
    snapshot ? `\nUnderwriting snapshot:\n${snapshotToText(snapshot)}` : null,
    `\nDocuments:\n${list}`,
    '',
    INSTRUCTIONS,
  ]
    .filter((l) => l !== null)
    .join('\n')

  const client = new Anthropic()
  const structured = await client.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(RecommendationSchema) },
  })
  await logUsage({ feature: 'attachment-recommendation', model: 'claude-opus-5-5', dealId, usage: structured.usage })
  if (!structured.parsed_output) throw new Error('Could not recommend attachments')

  const byRef = new Map(refs.map((r) => [r.ref, r.doc.id]))
  const decisions = structured.parsed_output.documents
    .filter((d) => byRef.has(d.ref))
    .map((d) => ({ id: byRef.get(d.ref)!, include: d.include, reason: d.reason }))
  return { decisions, note: structured.parsed_output.note }
}
