import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { logUsage } from '@/lib/usage'
import { LoanTypeBackfillSchema } from './backfill-loan-type-schema'
import { LOAN_TYPE_CATEGORIES } from './categories'
import type { Underwriting } from '@/lib/underwriting/schema'

// Deals per Claude call — see backfill-industry.ts for the same reasoning.
const BATCH_SIZE = 40

const INSTRUCTIONS = `You are classifying the type of financing a borrower needs for a debt brokerage's CRM, using only the company name, its deal notes, and its ask.

Choose exactly one of these fixed categories for each deal — do not invent new ones:
${LOAN_TYPE_CATEGORIES.map((c) => `- ${c}`).join('\n')}

Use "Other" when the ask clearly indicates a real financing need that just doesn't fit any category above (e.g. purchase order financing, litigation funding, DSCR/rental). If the notes and ask give genuinely no signal at all about what kind of financing is needed, return null rather than guessing.`

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export async function backfillLoanTypes() {
  const supabase = await createClient()

  const { data: allDeals, error } = await supabase
    .from('deals')
    .select('id, company_name, deal_type, notes, underwriting, loan_type')

  if (error) throw new Error('Failed to load deals')

  // Reclassify anything missing or not already one of the fixed
  // categories — covers both brand-new deals and deals still holding an
  // older freeform label from before the taxonomy was fixed.
  const deals = (allDeals ?? []).filter(
    (d) => !d.loan_type || !(LOAN_TYPE_CATEGORIES as readonly string[]).includes(d.loan_type)
  )

  if (deals.length === 0) {
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
      output_config: { format: zodOutputFormat(LoanTypeBackfillSchema) },
    })

    await logUsage({ feature: 'loan-type-standardize', model: 'claude-opus-5', usage: structured.usage })

    if (!structured.parsed_output) continue

    for (const c of structured.parsed_output.classifications) {
      const dealId = refMap.get(c.deal_ref)
      if (!dealId) continue
      // A null classification means "genuinely no signal" — clear the
      // field rather than leaving whatever freeform value was there
      // before, or old non-standard labels would keep polluting the
      // filter dropdown even after standardizing.
      const { error: updateError } = await supabase
        .from('deals')
        .update({ loan_type: c.loan_type })
        .eq('id', dealId)
      if (updateError) continue
      if (c.loan_type) updated++
      else skipped++
    }
  }

  return { updated, skipped, batches }
}
