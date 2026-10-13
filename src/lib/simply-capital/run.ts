import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { loadDealEmails, emailsToText } from '@/lib/deals/deal-emails'
import { snapshotToText } from '@/lib/snapshot/text'
import type { Snapshot } from '@/lib/snapshot/schema'
import { guessCategory } from '@/lib/documents/categories'
import { getDocText, renderPages } from '@/lib/chat/doc-text'
import type { DocumentRecord } from '@/lib/types'
import { SimplyCapitalSchema, type SimplyCapitalPrep } from './schema'

// Prepares Simply Capital's application for a deal: the answers for his
// Jotform and which files go in the upload. Reads what the CRM already has
// (borrower profile, underwriting snapshot, emails) plus the first page of
// the latest bank statements (for monthly sales) and the debt schedule.

const MODEL = 'claude-sonnet-5-5'
const STATEMENTS = 6
const MAX_IMAGES = 6

type Block = Anthropic.ContentBlockParam

export async function prepareSimplyCapital(supabase: SupabaseClient, dealId: string): Promise<SimplyCapitalPrep> {
  const [{ data: deal }, { data: documents }, emails] = await Promise.all([
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase.from('documents').select('*').eq('deal_id', dealId).order('uploaded_at', { ascending: false }),
    loadDealEmails(supabase, dealId, 12),
  ])
  if (!deal) throw new Error('Deal not found')

  const docs = (documents ?? []) as DocumentRecord[]
  const seen = new Set<string>()
  const unique = docs.filter((d) => {
    const k = `${d.file_name.toLowerCase()}|${d.file_size}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const cat = (d: DocumentRecord) => d.category || guessCategory(d.file_name, d.triage?.doc_type)

  const docList = unique
    .map((d) => `- [${d.id}] ${d.file_name} — ${cat(d)}${d.triage ? ` — ${d.triage.doc_type}: ${d.triage.summary}` : ''} (uploaded ${d.uploaded_at.slice(0, 10)})`)
    .join('\n')

  // First page of the newest statements (monthly totals) and the debt schedule.
  const blocks: Block[] = []
  let images = 0
  const pick = [...unique.filter((d) => cat(d) === 'Bank statements').slice(0, STATEMENTS * 2), ...unique.filter((d) => cat(d) === 'Debt schedule & loans').slice(0, 2)]
  for (const d of pick) {
    const text = await getDocText(supabase, d).catch(() => null)
    if (!text?.pageCount) continue
    if (!text.scanned.includes(1)) {
      blocks.push({ type: 'text', text: `--- ${d.file_name} [${d.id}], page 1 ---\n${text.pages[0].slice(0, 4000)}` })
    } else if (images < MAX_IMAGES) {
      const [img] = await renderPages(supabase, d, [1]).catch(() => [])
      if (img) {
        blocks.push({ type: 'text', text: `--- ${d.file_name} [${d.id}], page 1 (scan) ---` })
        blocks.push({ type: 'image', source: { type: 'base64', media_type: img.media, data: img.data } })
        images++
      }
    }
  }

  const profile = deal.borrower_profile ? `Borrower profile (from tax returns / entity papers):\n${JSON.stringify(deal.borrower_profile)}` : 'No borrower profile yet.'
  const header = [
    `Deal: ${deal.company_name}`,
    `Contact: ${[deal.contact_name, deal.contact_email, deal.contact_phone].filter(Boolean).join(', ') || '—'}`,
    deal.deal_type ? `Ask: ${deal.deal_type}` : null,
    deal.loan_type ? `Loan type: ${deal.loan_type}` : null,
    deal.industry ? `Industry: ${deal.industry}` : null,
    deal.description ? `Description: ${deal.description}` : null,
    deal.notes ? `Notes: ${deal.notes}` : null,
    profile,
    deal.snapshot ? `Underwriting snapshot:\n${snapshotToText(deal.snapshot as Snapshot)}` : null,
    emailsToText(emails, 15000),
    `Documents on the deal:\n${docList || 'None.'}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const rules = `You are preparing a small-business loan application (Simply Capital's form) for a broker, from the deal material above and the statement / debt-schedule pages that follow it.

- Fill each form field only from the material; copy names, addresses and numbers exactly. Unknown = null. Never invent.
- monthly_sales: average total monthly deposits across the latest statements you can see, excluding transfers between the company's own accounts and loan proceeds. Say in "check" how many months and which accounts you used.
- open_loans_or_mca: Yes if the debt schedule, statements (recurring lender/MCA debits) or emails show any term loan or merchant cash advance.
- files: for each of the 5 items pick the matching document ids from the list. Bank statements = the latest 6 months across all business accounts, newest first. Mark partial/missing honestly and say what's missing.
- Never output a Social Security number, date of birth or credit score — those are entered by hand.`

  const response = await new Anthropic().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: 'medium', format: zodOutputFormat(SimplyCapitalSchema) },
    messages: [{ role: 'user', content: [{ type: 'text', text: header }, ...blocks, { type: 'text', text: rules }] }],
  })
  await logUsage({ feature: 'simply-capital', model: MODEL, dealId, usage: response.usage })
  const out = response.parsed_output
  if (!out) throw new Error('Couldn’t prepare the application')
  // Only ids that really belong to this deal.
  const ids = new Set(docs.map((d) => d.id))
  out.files = out.files.map((f) => ({ ...f, document_ids: f.document_ids.filter((id) => ids.has(id)) }))
  return out
}
