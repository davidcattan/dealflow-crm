import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { logUsage } from '@/lib/usage'
import { buildDealProfile } from '@/lib/matching/deal-profile'
import { LoanTypeRecommendationSchema } from './recommend-loan-type-schema'
import { LOAN_TYPE_CATEGORIES } from './categories'
import type { Deal, DealUpdate } from '@/lib/types'

const INSTRUCTIONS = `You are an asset-based lending broker's assistant. Based on the deal profile below — its AI underwriting (financials, current position, strengths, risks) if available, its notes, and its recent activity log — recommend the single loan/financing type that best fits what this borrower actually needs and could realistically qualify for.

Choose exactly one of these fixed categories, or null if there is genuinely no signal to go on:
${LOAN_TYPE_CATEGORIES.map((c) => `- ${c}`).join('\n')}

Weigh the borrower's actual collateral and financial position (e.g. strong AR/inventory points to ABL, real estate ownership points to HELOC or a real-estate product, heavy equipment points to equipment financing) over any single throwaway phrase in the notes. Do not invent facts not present in the deal profile.`

export async function recommendLoanType(dealId: string) {
  const supabase = await createClient()

  const [{ data: deal, error: dealError }, { data: updates }] = await Promise.all([
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase
      .from('deal_updates')
      .select('entry_date, note')
      .eq('deal_id', dealId)
      .order('entry_date', { ascending: false, nullsFirst: false })
      .limit(8),
  ])

  if (dealError || !deal) {
    throw new Error('Deal not found')
  }
  if (!deal.underwriting) {
    throw new Error('Run underwriting on this deal before recommending a loan type.')
  }

  const dealProfile = buildDealProfile(
    deal as Deal,
    updates as Pick<DealUpdate, 'entry_date' | 'note'>[] | null
  )

  const client = new Anthropic()

  const structured = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: [dealProfile, '', INSTRUCTIONS].join('\n'),
      },
    ],
    output_config: { format: zodOutputFormat(LoanTypeRecommendationSchema) },
  })

  await logUsage({ feature: 'loan-type-recommendation', model: 'claude-opus-5', dealId: dealId, usage: structured.usage })

  if (!structured.parsed_output) {
    throw new Error('Could not produce a loan type recommendation')
  }

  const { loan_type, reasoning } = structured.parsed_output

  if (loan_type) {
    await supabase.from('deals').update({ loan_type }).eq('id', dealId)
  }

  return { loanType: loan_type, reasoning }
}
