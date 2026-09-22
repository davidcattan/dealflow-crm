import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { MatchSchema } from './schema'
import { buildDealProfile } from './deal-profile'
import type { Deal, DealUpdate } from '@/lib/types'

const MATCH_INSTRUCTIONS = `You are helping an asset-based lending broker match a borrower deal to the lenders most likely to fund it. Most lenders here describe their mandate in free-text notes, not clean structured fields — read those notes carefully rather than relying only on the loan-size numbers.

Consider, in rough priority order:
1. Loan size fit (the lender's min/max against what the deal appears to need, if known).
2. Asset type / lending type fit (e.g. AR & inventory ABL vs. equipment vs. real estate vs. cash-flow term loan vs. factoring) — this is usually the biggest factor.
3. Revenue/EBITDA minimums, if the lender specifies them and the deal's financials are known.
4. Industry fit or exclusions mentioned in the lender's notes.
5. Anything else in the lender's notes that clearly rules a deal in or out (e.g. "won't do cannabis", "SBA lender", "needs PE sponsor").

Most real deals here are small private companies with thin or incomplete documentation — that is normal. If the deal has no underwriting or financials yet, match on industry/asset-type/loan-size signals from its notes and flag in your overall notes that financials would sharpen the match. Do not invent numbers that were not given to you.

Return only lenders that are genuinely plausible — it is fine and expected to return fewer than 10, or even just 1-2, for a niche or thin deal. Reference lenders by their L# from the list, not by name.`

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export async function runMatching(dealId: string) {
  const supabase = await createClient()

  const [{ data: deal, error: dealError }, { data: lenders }, { data: updates }] =
    await Promise.all([
      supabase.from('deals').select('*').eq('id', dealId).single(),
      supabase
        .from('lenders')
        .select(
          'id, name, lending_type, min_loan_amount, max_loan_amount, min_revenue, min_ebitda, cares_about_profit, asset_types, industries, geographies, mandate_notes'
        )
        .eq('status', 'active'),
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
  if (!lenders || lenders.length === 0) {
    throw new Error('No active lenders to match against')
  }

  const lenderRefs = new Map<string, string>() // L# -> lender uuid
  const lenderLines = lenders.map((l, i) => {
    const ref = `L${i + 1}`
    lenderRefs.set(ref, l.id)

    const parts = [
      `${ref}: ${l.name}`,
      l.lending_type ? `type: ${l.lending_type}` : null,
      l.min_loan_amount || l.max_loan_amount
        ? `loan size: ${l.min_loan_amount ?? '?'}–${l.max_loan_amount ?? '?'}`
        : null,
      l.min_revenue ? `min revenue: ${l.min_revenue}` : null,
      l.min_ebitda ? `min EBITDA: ${l.min_ebitda}` : null,
      l.cares_about_profit !== null ? `cares about profit: ${l.cares_about_profit ? 'yes' : 'no'}` : null,
      l.asset_types.length > 0 ? `asset types: ${l.asset_types.join(', ')}` : null,
      l.industries.length > 0 ? `industries: ${l.industries.join(', ')}` : null,
      l.geographies.length > 0 ? `geographies: ${l.geographies.join(', ')}` : null,
      l.mandate_notes ? `notes: ${truncate(l.mandate_notes, 500)}` : null,
    ].filter(Boolean)

    return parts.join(' | ')
  })

  const dealProfile = buildDealProfile(deal as Deal, updates as Pick<DealUpdate, 'entry_date' | 'note'>[] | null)

  const client = new Anthropic()

  const structured = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          dealProfile,
          '',
          '--- Lender list ---',
          lenderLines.join('\n'),
          '',
          MATCH_INSTRUCTIONS,
        ].join('\n'),
      },
    ],
    output_config: { format: zodOutputFormat(MatchSchema) },
  })

  if (!structured.parsed_output) {
    throw new Error('Could not produce lender matches')
  }

  const resolvedMatches = structured.parsed_output.matches
    .map((m) => ({
      lenderId: lenderRefs.get(m.lender_ref) ?? null,
      score: m.score,
      reasoning: m.reasoning,
    }))
    .filter((m): m is { lenderId: string; score: number; reasoning: string } => m.lenderId !== null)

  return { matches: resolvedMatches, notes: structured.parsed_output.notes }
}
