import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ASSET_TYPE_CATEGORIES, GEOGRAPHY_CATEGORIES, INDUSTRY_CATEGORIES } from './categories'

// What the Claude Code queue job found about a lender online (its own
// website first). Saved by /api/lenders/[id]/save-research. Free — no API
// call; the job runs on the team's Claude plan.
export const LenderResearchSchema = z.object({
  found: z.boolean().describe('False when nothing reliable about this exact firm was found.'),
  summary: z
    .string()
    .describe('2-4 plain sentences: what the firm is and what it lends on (products, sizes, industries, collateral, geography). Only what sources state.'),
  lending_type: z.string().nullable().describe('Short label, e.g. "Bank ABL", "Direct lending - senior term loans", "Factoring". Null if unclear.'),
  min_loan_amount: z.number().nullable().describe('Whole US dollars, only if a source states it.'),
  max_loan_amount: z.number().nullable(),
  min_revenue: z.number().nullable(),
  min_ebitda: z.number().nullable(),
  asset_types: z.array(z.enum(ASSET_TYPE_CATEGORIES)).describe('Collateral they lend against, only if stated.'),
  industries: z.array(z.enum(INDUSTRY_CATEGORIES)).describe('Only industries they specialize in. Empty for generalists.'),
  geographies: z.array(z.enum(GEOGRAPHY_CATEGORIES)).describe('Empty = nationwide or not stated.'),
  website: z.string().nullable(),
  sources: z.array(z.string()).describe('URLs the facts came from.'),
})
export type LenderResearch = z.infer<typeof LenderResearchSchema>

// Fills only empty fields — what the team typed or a lender said in email
// always wins — and adds the summary to the lender notes with its sources.
export async function saveLenderResearch(supabase: SupabaseClient, lenderId: string, r: LenderResearch) {
  const { data: lender, error } = await supabase.from('lenders').select('*').eq('id', lenderId).single()
  if (error || !lender) throw new Error(error?.message ?? 'Lender not found')
  const stamp = new Date().toISOString().slice(0, 10)
  const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || v === 0
  const update: Record<string, unknown> = { researched_at: new Date().toISOString(), research_requested_at: null }
  if (r.found) {
    const fill: Record<string, unknown> = {
      lending_type: r.lending_type,
      min_loan_amount: r.min_loan_amount,
      max_loan_amount: r.max_loan_amount,
      min_revenue: r.min_revenue,
      min_ebitda: r.min_ebitda,
      asset_types: r.asset_types,
      industries: r.industries,
      geographies: r.geographies,
      website: r.website,
    }
    for (const [k, v] of Object.entries(fill)) if (!empty(v) && empty(lender[k])) update[k] = v
  }
  const line = r.found
    ? `[${stamp} web research] ${r.summary.trim()}${r.sources.length ? ` (Sources: ${r.sources.slice(0, 4).join(', ')})` : ''}`
    : `[${stamp} web research] Nothing reliable found online about this firm.`
  update.mandate_notes = lender.mandate_notes ? `${lender.mandate_notes}\n${line}` : line
  const { error: saveError } = await supabase.from('lenders').update(update).eq('id', lenderId)
  if (saveError) throw new Error(saveError.message)
}
