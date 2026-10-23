import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { formatCompactCurrency } from '@/lib/format'
import { readFileText } from '@/lib/chat/doc-text'
import {
  LENDING_TYPE_CATEGORIES,
  ASSET_TYPE_CATEGORIES,
  INDUSTRY_CATEGORIES,
  GEOGRAPHY_CATEGORIES,
} from '@/lib/lenders/categories'
import { LenderCallNotesSchema } from '@/lib/calls/schema'
import { lenderChangeLabel, lenderChangeUpdate } from '@/lib/calls/lender-call'

// A lender's tear sheet (or term sheet / program guide) uploaded on their
// profile: the AI reads what kind of lender they are — loan sizes, what they
// lend on, LTV, regions — and fills in the profile right away, so matching
// sends them the right deals. A short summary goes into the mandate notes,
// which matching reads too.

const MODEL = 'claude-opus-5-5'

const TearSheetSchema = LenderCallNotesSchema.pick({ lender_changes: true, new_contacts: true }).extend({
  summary: z.string().describe('2-3 plain sentences: who they are and what they lend on (product, size, collateral, where).'),
  key_points: z
    .array(z.string())
    .describe('Concrete terms on the sheet: loan sizes, LTV/LTC, rates, points, terms, lien position, property/asset types, states, speed to close, what they avoid. One short line each.'),
})

export async function readTearSheet(supabase: SupabaseClient, documentId: string) {
  const { data: doc } = await supabase.from('lender_documents').select('*').eq('id', documentId).single()
  if (!doc) throw new Error('Document not found')
  const [{ data: lender }, { data: contacts }] = await Promise.all([
    supabase.from('lenders').select('*').eq('id', doc.lender_id).single(),
    supabase.from('lender_contacts').select('name, email').eq('lender_id', doc.lender_id),
  ])
  if (!lender) throw new Error('Lender not found')

  const text = await readFileText(supabase, doc)
  const body = (text?.pages ?? []).map((p, i) => `--- Page ${i + 1} ---\n${p}`).join('\n').trim()
  if (!body) throw new Error('Couldn’t read any text in this file')

  const money = (n: number | null) => (n === null ? '—' : formatCompactCurrency(n))
  const profile = [
    `LENDER: ${lender.name}`,
    `Lending type: ${lender.lending_type ?? '—'} | Loan size: ${money(lender.min_loan_amount)} – ${money(lender.max_loan_amount)}`,
    `Min revenue: ${money(lender.min_revenue)} | Min EBITDA: ${money(lender.min_ebitda)}`,
    `Asset types: ${lender.asset_types?.join(', ') || 'any'} | Industries: ${lender.industries?.join(', ') || 'any'} | Regions: ${lender.geographies?.join(', ') || 'nationwide'}`,
    `Website: ${lender.website ?? '—'}`,
    lender.mandate_notes ? `Mandate notes: ${lender.mandate_notes}` : null,
    `Contacts on file: ${(contacts ?? []).map((c) => [c.name, c.email].filter(Boolean).join(' / ')).join('; ') || 'none'}`,
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `You work for JED Capital Group, a commercial loan brokerage. This lender sent us their tear sheet (a one-page summary of what they lend on), or a similar program sheet. Read it and update their profile in our CRM so we only send them deals they do.

CURRENT LENDER PROFILE IN THE CRM:
${profile}

THE FILE ("${doc.file_name}"):
${body.slice(0, 60_000)}

Stick to what the sheet actually says — never guess numbers or criteria. Suggest a profile change only where the sheet states something that differs from (or is missing in) the profile; the sheet comes from the lender, so it wins over what's on file. If they have several programs, set the loan size range to cover all of them and describe each program in one add_to_mandate_notes line (e.g. "Bridge: $250K–$5M, up to 75% LTV, 1st lien, 12–24 months"). Note lien position (1st only / 2nds too), owner-occupied vs investment, and minimum credit if stated.
Allowed values — lending_type (one of): ${LENDING_TYPE_CATEGORIES.join(', ')}
asset_types: ${ASSET_TYPE_CATEGORIES.join(', ')}
industries: ${INDUSTRY_CATEGORIES.join(', ')}
geographies: ${GEOGRAPHY_CATEGORIES.join(', ')}, or Nationwide`

  const response = await new Anthropic().messages.parse({
    model: MODEL,
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(TearSheetSchema) },
  })
  await logUsage({ feature: 'lender-tear-sheet', model: MODEL, usage: response.usage, supabase })
  const sheet = response.parsed_output
  if (!sheet) throw new Error('Couldn’t read the tear sheet')

  // Apply it all — the lender sent this themselves.
  const stamp = `${new Date().toISOString().slice(0, 10)} (tear sheet)`
  const update: Record<string, unknown> = {}
  const changes: string[] = []
  for (const c of sheet.lender_changes) {
    const u = lenderChangeUpdate(lender, c, stamp)
    if (!u) continue
    Object.assign(update, u)
    changes.push(lenderChangeLabel(c))
  }
  if (Object.keys(update).length) {
    const { error } = await supabase.from('lenders').update(update).eq('id', lender.id)
    if (error) throw new Error(`Couldn’t update the lender: ${error.message}`)
  }
  const known = new Set((contacts ?? []).map((c) => (c.email ?? '').toLowerCase()).filter(Boolean))
  for (const c of sheet.new_contacts) {
    const email = c.email?.toLowerCase() ?? null
    if (email && known.has(email)) continue
    await supabase.from('lender_contacts').insert({ lender_id: lender.id, name: c.name, title: c.title, email, phone: c.phone })
    changes.push(`Add contact: ${[c.name, c.title, email].filter(Boolean).join(', ')}`)
  }

  const summary = [sheet.summary, ...sheet.key_points.map((p) => `• ${p}`)].join('\n')
  await supabase.from('lender_documents').update({ summary, changes }).eq('id', documentId)
  return { summary, changes }
}

// Shown while a file is being read (so two runs don't read it twice).
export const READING = '(reading…)'

// Lender files that came in by email (saved unread): read a few per
// scheduled run. A read that died partway is picked up again after 15 min.
export async function readPendingLenderDocuments(supabase: SupabaseClient, limit = 4) {
  const stale = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data } = await supabase
    .from('lender_documents')
    .select('id')
    .or(`summary.is.null,and(summary.eq."${READING}",created_at.lt.${stale})`)
    .order('created_at', { ascending: true })
    .limit(limit)
  for (const d of data ?? []) {
    const { data: claimed } = await supabase
      .from('lender_documents')
      .update({ summary: READING })
      .eq('id', d.id)
      .or(`summary.is.null,summary.eq."${READING}"`)
      .select('id')
    if (!claimed?.length) continue
    await readTearSheet(supabase, d.id as string).catch(async (err) => {
      await supabase
        .from('lender_documents')
        .update({ summary: `Couldn’t read it: ${err instanceof Error ? err.message : 'unknown error'}` })
        .eq('id', d.id)
    })
  }
}
