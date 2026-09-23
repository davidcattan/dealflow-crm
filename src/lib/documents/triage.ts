import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { logUsage } from '@/lib/usage'
import { DocTriageSchema } from './triage-schema'
import type { DocumentRecord } from '@/lib/types'

const TRIAGE_MODEL = 'claude-opus-5'

const INSTRUCTIONS = `You are triaging a document uploaded for an asset-based lending underwriting file. Decide which pages carry real underwriting signal and which are boilerplate, so the full underwriting pass only needs to read the pages that matter.

Signal (keep): revenue/income/profit totals, P&L and balance-sheet lines, AR/inventory/equipment/real-estate values, debt and lender schedules, collateral or fixed-asset lists, tax-return summary pages and the schedules that carry actual business income/expenses/depreciation, ownership info, anything unusual or explanatory about the business.
Boilerplate (omit): cover letters, e-file authorizations, filing instructions, blank or all-zero forms and worksheets, repeated statutory disclosures, state forms that merely restate federal numbers, page after page of standard detail with no new figures.

Be conservative — when unsure whether a page matters, include it. Never omit a page containing figures about revenue, profit, assets, liabilities, debt or equipment. For documents of 10 pages or fewer, return every page as one range.`

export async function triageDocument(doc: DocumentRecord): Promise<DocumentRecord['triage']> {
  const supabase = await createClient()

  const { data, error } = await supabase.storage
    .from('borrower-documents')
    .download(doc.storage_path)
  if (error || !data) throw new Error(`Could not download ${doc.file_name}`)

  const buffer = Buffer.from(await data.arrayBuffer())
  const client = new Anthropic()

  const structured = await client.messages.parse({
    model: TRIAGE_MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
          },
          { type: 'text', text: `File name: ${doc.file_name}\n\n${INSTRUCTIONS}` },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(DocTriageSchema) },
  })

  await logUsage({ feature: 'document-triage', model: TRIAGE_MODEL, dealId: doc.deal_id, usage: structured.usage })

  const triage = structured.parsed_output
  if (!triage) throw new Error(`Could not triage ${doc.file_name}`)

  await supabase
    .from('documents')
    .update({ triage, triaged_at: new Date().toISOString() })
    .eq('id', doc.id)

  return triage
}

export async function triageDealDocuments(dealId: string) {
  const supabase = await createClient()
  const { data: docs } = await supabase
    .from('documents')
    .select('*')
    .eq('deal_id', dealId)
    .is('triage', null)

  const pdfs = ((docs ?? []) as DocumentRecord[]).filter(
    (d) => d.content_type === 'application/pdf' || d.file_name.toLowerCase().endsWith('.pdf')
  )

  let done = 0
  const failed: string[] = []
  for (const doc of pdfs) {
    try {
      await triageDocument(doc)
      done++
    } catch (err) {
      console.error('Triage failed', { doc: doc.file_name, err })
      failed.push(doc.file_name)
    }
  }
  return { done, failed }
}
