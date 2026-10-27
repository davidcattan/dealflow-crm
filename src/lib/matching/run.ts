import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { logUsage } from '@/lib/usage'
import { MatchSchema } from './schema'
import { buildDealProfile } from './deal-profile'
import type { Deal, DealUpdate } from '@/lib/types'

const MATCH_INSTRUCTIONS = `You are helping a commercial debt broker (asset-based lending, cash-flow lending, acquisition financing and real estate) match a borrower deal to the lenders most likely to fund it. Most lenders here describe their mandate in free-text notes, not clean structured fields — read those notes carefully rather than relying only on the loan-size numbers.

The deal's "Loan type" is the broker's starting guess, not a filter. Match every product the deal can genuinely support:
- Collateral (receivables, inventory, equipment, real estate) supports asset-based, equipment and real estate lenders.
- Real, recurring profit supports cash-flow lenders (senior cash-flow term loans, unitranche, private credit, mezzanine/junior capital). As a rough guide, about $2-3M+ of EBITDA (or the lender's stated minimum) makes a company a cash-flow candidate; at $5M+ EBITDA cash-flow lenders are usually as relevant as ABL.
- Most deals have more than one way to get done, and the team pursues all of them. First work out the 2-4 financing solutions this deal could realistically use (e.g. ABL refinance, cash-flow term loan, junior/growth capital, equipment term loan, real estate loan, SBA, factoring) — only ones its collateral, profit and ask actually support. Then return the strongest 2-5 lenders for each solution, labeled with that solution.

Consider, in rough priority order:
1. Loan size fit (the lender's min/max against what the deal appears to need, if known).
2. Product fit — which structure this lender would provide (AR & inventory ABL, equipment, real estate, cash-flow term loan / unitranche, junior capital, factoring) and whether the deal's collateral or EBITDA supports it. This is usually the biggest factor.
3. Revenue/EBITDA minimums, if the lender specifies them and the deal's financials are known.
4. Industry fit or exclusions mentioned in the lender's notes.
5. Anything else in the lender's notes that clearly rules a deal in or out (e.g. "won't do cannabis", "SBA lender", "needs PE sponsor").
6. The team's track record with the lender — as important as fit on paper. Lenders that were interested in, issued term sheets on or funded similar deals for the team rank high; lenders that keep declining similar deals rank lower. A lender this deal was already sent to that is interested belongs near the top. A good-looking mandate with no history is weaker than a proven relationship.

Lenders under "New lenders" have no relationship with the team yet (no deals sent, no emails). Include at most 2 of them, only when clearly strong fits, and score them below comparable lenders the team works with.

Most real deals here are small private companies with thin or incomplete documentation — that is normal. If the deal has no underwriting or financials yet, match on industry/asset-type/loan-size signals from its notes and flag in your overall notes that financials would sharpen the match. Do not invent numbers that were not given to you.

Return only lenders that are genuinely plausible — for a niche or thin deal it is fine to return just a few, even if that leaves a solution with only one lender. Reference lenders by their L# from the list, not by name.`

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export async function runMatching(dealId: string) {
  const supabase = await createClient()

  const [{ data: deal, error: dealError }, { data: allLenders }, { data: updates }, { data: submissions }, { data: dealNames }, { data: emailed }] =
    await Promise.all([
      supabase.from('deals').select('*').eq('id', dealId).single(),
      // Everything, so match_excluded / research_lead are read when present
      // (migration 046) and ignored before it.
      supabase.from('lenders').select('*').eq('status', 'active'),
      supabase
        .from('deal_updates')
        .select('entry_date, note')
        .eq('deal_id', dealId)
        .order('entry_date', { ascending: false, nullsFirst: false })
        .limit(8),
      supabase.from('deal_submissions').select('lender_id, deal_id, status, sent_on').order('sent_on', { ascending: false }).limit(5000),
      supabase.from('deals').select('id, company_name, loan_type'),
      supabase.from('inbox_messages').select('lender_id').not('lender_id', 'is', null).limit(20000),
    ])
  const lenders = (allLenders ?? []).filter((l) => !l.match_excluded && l.is_lender !== false)

  if (dealError || !deal) {
    throw new Error('Deal not found')
  }
  if (!lenders || lenders.length === 0) {
    throw new Error('No active lenders to match against')
  }

  // The team's history with each lender, from every deal sent to them.
  const dealById = new Map((dealNames ?? []).map((d) => [d.id as string, d]))
  const subsByLender = new Map<string, { deal_id: string; status: string }[]>()
  for (const s of submissions ?? []) subsByLender.set(s.lender_id, [...(subsByLender.get(s.lender_id) ?? []), s])
  const emailCount = new Map<string, number>()
  for (const e of emailed ?? []) emailCount.set(e.lender_id, (emailCount.get(e.lender_id) ?? 0) + 1)
  // Researched lenders count as known once a deal goes to them or they email.
  const isNew = (l: { id: string; research_lead?: boolean }) =>
    Boolean(l.research_lead) && !subsByLender.has(l.id) && !emailCount.has(l.id)

  function trackRecord(lenderId: string) {
    const subs = (subsByLender.get(lenderId) ?? []).filter((s) => s.deal_id !== dealId)
    const emails = emailCount.get(lenderId) ?? 0
    if (!subs.length) return emails ? `track record: no other deals sent yet; ${emails} emails with the team` : 'track record: no deals sent yet'
    const tally = (st: string[]) => subs.filter((s) => st.includes(s.status)).length
    const recent = subs
      .slice(0, 5)
      .map((s) => {
        const d = dealById.get(s.deal_id)
        return `${d?.company_name ?? 'a deal'}${d?.loan_type ? ` (${d.loan_type})` : ''}: ${s.status.replace(/_/g, ' ')}`
      })
      .join('; ')
    return `track record: ${subs.length} deals sent — ${tally(['interested', 'needs_more_info'])} engaged, ${tally(['term_sheet', 'funded'])} term sheet/funded, ${tally(['declined'])} declined, ${tally(['sent'])} no answer yet. Recent: ${recent}`
  }

  const lenderRefs = new Map<string, string>() // L# -> lender uuid
  const newLenderIds = new Set<string>()
  const ordered = [...lenders.filter((l) => !isNew(l)), ...lenders.filter((l) => isNew(l))]
  const knownCount = lenders.length - lenders.filter((l) => isNew(l)).length
  const lenderLines = ordered.map((l, i) => {
    const ref = `L${i + 1}`
    lenderRefs.set(ref, l.id)
    if (isNew(l)) newLenderIds.add(l.id)

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
      isNew(l) ? null : trackRecord(l.id),
      l.mandate_notes ? `notes: ${truncate(l.mandate_notes, 3000)}` : null,
    ].filter(Boolean)

    return parts.join(' | ')
  })

  const dealProfile = buildDealProfile(deal as Deal, updates as Pick<DealUpdate, 'entry_date' | 'note'>[] | null)
  const lenderName = new Map(lenders.map((l) => [l.id as string, l.name as string]))
  const alreadySent = (submissions ?? [])
    .filter((s) => s.deal_id === dealId && lenderName.has(s.lender_id))
    .map((s) => `${lenderName.get(s.lender_id)}: ${s.status.replace(/_/g, ' ')}`)

  const client = new Anthropic()

  const structured = await client.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          // Same for every deal until the lender list or history changes, so
          // it's cached across back-to-back match runs.
          {
            type: 'text',
            text: [
              '--- Lenders the team works with ---',
              lenderLines.slice(0, knownCount).join('\n'),
              '',
              '--- New lenders (no relationship yet) ---',
              lenderLines.slice(knownCount).join('\n') || '(none)',
            ].join('\n'),
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: [
              dealProfile,
              alreadySent.length ? `\nThis deal was already sent to: ${alreadySent.join('; ')}` : '',
              '',
              MATCH_INSTRUCTIONS,
            ].join('\n'),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(MatchSchema) },
  })

  await logUsage({ feature: 'matching', model: 'claude-opus-5-5', dealId: dealId, usage: structured.usage })

  if (!structured.parsed_output) {
    throw new Error('Could not produce lender matches')
  }

  let newKept = 0
  const resolvedMatches = structured.parsed_output.matches
    .map((m) => ({
      lenderId: lenderRefs.get(m.lender_ref) ?? null,
      score: m.score,
      // "Cash-flow term loan — …": the solution leads, so the list reads by option.
      reasoning: m.solution ? `${m.solution} — ${m.reasoning}` : m.reasoning,
    }))
    .filter((m): m is { lenderId: string; score: number; reasoning: string } => m.lenderId !== null)
    // At most 2 lenders the team has never worked with, labeled as such.
    .filter((m) => !newLenderIds.has(m.lenderId) || ++newKept <= 2)
    .map((m) => (newLenderIds.has(m.lenderId) ? { ...m, reasoning: `New lender — no relationship yet. ${m.reasoning}` } : m))

  return { matches: resolvedMatches, notes: structured.parsed_output.notes }
}
