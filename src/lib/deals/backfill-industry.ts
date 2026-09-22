import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { IndustryBackfillSchema } from './backfill-industry-schema'
import type { Underwriting } from '@/lib/underwriting/schema'

// Deals per Claude call. Classification is a light task per deal, so a
// large batch keeps total call count (and cost) low even across the whole
// pipeline.
const BATCH_SIZE = 40

const INSTRUCTIONS = `You are classifying the industry of small/private borrower companies for a debt brokerage's CRM, using only their company name, deal notes, and ask. Most of these are small private businesses — infer from name conventions and context (e.g. "... Construction LLC", "... Auto Sale", "... Concrete") where possible. Use a short, general category (2-4 words) rather than an overly specific one. If a company name and notes give genuinely no signal (e.g. a personal name with no other context), return null rather than guessing.`

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export async function backfillIndustries() {
  const supabase = await createClient()

  const { data: deals, error } = await supabase
    .from('deals')
    .select('id, company_name, deal_type, notes, underwriting')
    .is('industry', null)

  if (error) throw new Error('Failed to load deals')
  if (!deals || deals.length === 0) {
    return { updated: 0, skipped: 0, batches: 0 }
  }

  const client = new Anthropic()
  let updated = 0
  let skipped = 0
  let batches = 0

  for (let i = 0; i < deals.length; i += BATCH_SIZE) {
    const batch = deals.slice(i, i + BATCH_SIZE)
    batches++

    const refMap = new Map<string, string>() // D# -> deal uuid
    const lines = batch.map((d, idx) => {
      const ref = `D${idx + 1}`
      refMap.set(ref, d.id)
      const underwriting = d.underwriting as Underwriting | null

      const parts = [
        `${ref}: ${d.company_name}`,
        d.deal_type ? `ask: ${d.deal_type}` : null,
        d.notes ? `notes: ${truncate(d.notes, 300)}` : null,
        underwriting?.company_overview
          ? `overview: ${truncate(underwriting.company_overview, 300)}`
          : null,
      ].filter(Boolean)

      return parts.join(' | ')
    })

    const structured = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [lines.join('\n'), '', INSTRUCTIONS].join('\n'),
        },
      ],
      output_config: { format: zodOutputFormat(IndustryBackfillSchema) },
    })

    if (!structured.parsed_output) continue

    for (const c of structured.parsed_output.classifications) {
      const dealId = refMap.get(c.deal_ref)
      if (!dealId) continue
      if (!c.industry) {
        skipped++
        continue
      }
      const { error: updateError } = await supabase
        .from('deals')
        .update({ industry: c.industry })
        .eq('id', dealId)
      if (!updateError) updated++
    }
  }

  return { updated, skipped, batches }
}
