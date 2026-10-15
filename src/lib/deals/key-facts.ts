import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { getDocText } from '@/lib/chat/doc-text'
import { snapshotToText } from '@/lib/snapshot/text'
import type { Snapshot } from '@/lib/snapshot/schema'
import { ownText } from '@/lib/outlook/own-text'
import type { DocumentRecord } from '@/lib/types'

// Cheap model: this is finding and copying facts, not judgment. ~1–3¢.
const MODEL = 'claude-haiku-5-5'

export type KeyFact = { label: string; value: string; source: string; note?: string; pinned?: boolean }
// v: the format version — older (wordier) key facts are re-read once.
export type KeyFacts = { summary?: string; facts: KeyFact[]; missing: string[]; v?: number }
export const KEY_FACTS_VERSION = 3

const Schema = z.object({
  summary: z
    .string()
    .describe(
      'What we know, in ONE sentence of at most 30 words — what the business/property is, the ask, and where it stands. e.g. "San Jose contract electronics maker, $4.6M revenue, wants a ~$400K ABL line to replace Huntington; financials in, waiting on credit and inventory list."'
    ),
  facts: z
    .array(
      z.object({
        label: z.string().describe('1–3 words: "Property address", "Revenue FY25", "AR", "Current lender".'),
        value: z
          .string()
          .describe('As short as possible — a number, a name or an address. "$4.6M", "$910K", "Huntington ($235K SBA)". No explanations, no parentheses beyond a few words.'),
        note: z.string().describe('Optional extra context in one short sentence (conflicting figures, breakdowns); "" if none.'),
        source: z.string().describe('2–4 words: "Tax returns", "Call 10/14", "Balance sheet 9/30", "Email from Mark".'),
      })
    )
    .describe('The 8 facts that matter MOST for this kind of deal, most important first. Only facts actually found. Never more than 8.'),
  missing: z.array(z.string()).describe('At most 3 of the most important facts NOT found anywhere — 1–3 words each.'),
})

const GUIDE = `Pick the facts a commercial loan broker needs at a glance for THIS kind of deal:
- Real estate / HELOC / bridge / construction: property address (full), property type, occupancy (who lives there / rented), estimated or appraised value (and basis), existing liens with balances, lenders and rates, LTV / combined LTV, who is on title, borrower(s), credit score(s), income, use of funds, the ask, timing.
- ABL / working capital / factoring: legal entity name, location, what they do, revenue (latest periods), EBITDA, AR, inventory, current lender and facility (size, maturity), total debt, the ask, use of funds, timing.
- Equipment / term / SBA / M&A: the asset or target, cost, revenue / EBITDA, collateral, current debt, the ask, timing.
Rules: only facts actually stated in the material below — never guess or calculate new numbers (except LTV when both value and loan are stated). When sources disagree, use the newest and put the conflict in the note. Pick only the 8 most important; values must be glanceable — round money ($4.6M, $910K), no sentences.`

export async function buildKeyFacts(supabase: SupabaseClient, dealId: string): Promise<KeyFacts> {
  const [{ data: deal }, { data: updates }, { data: calls }, { data: emails }, { data: docs }, { data: contacts }] = await Promise.all([
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase.from('deal_updates').select('entry_date, note').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(25),
    supabase.from('deal_calls').select('created_at, transcript, result, call_with').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(6),
    supabase.from('inbox_messages').select('received_at, from_email, subject, summary, body_text, classification').eq('deal_id', dealId).order('received_at', { ascending: false }).limit(15),
    supabase.from('documents').select('*').eq('deal_id', dealId).order('uploaded_at', { ascending: false }),
    supabase.from('deal_contacts').select('name, title, email, phone').eq('deal_id', dealId),
  ])
  if (!deal) throw new Error('Deal not found')
  // Nowhere to save them yet: don't spend anything.
  if (!('key_facts' in deal)) throw new Error('key_facts column missing — run migration 044_key_facts.sql')

  const parts: string[] = [
    `DEAL: ${deal.company_name}`,
    `Loan type: ${deal.loan_type ?? '—'} | Ask: ${deal.deal_type ?? '—'} | Industry: ${deal.industry ?? '—'} | Website: ${deal.website ?? '—'}`,
    `Contact: ${[deal.contact_name, deal.contact_phone, deal.contact_email].filter(Boolean).join(', ') || '—'}`,
    (contacts ?? []).length ? `Other contacts: ${(contacts ?? []).map((c) => [c.name, c.title, c.email, c.phone].filter(Boolean).join(', ')).join(' | ')}` : '',
    deal.description ? `Description: ${deal.description}` : '',
    deal.notes ? `Deal notes: ${deal.notes}` : '',
  ]
  if ((updates ?? []).length) parts.push(`\n--- Notes / updates (newest first) ---\n${(updates ?? []).map((u) => `[${u.entry_date ?? ''}] ${u.note}`).join('\n')}`)
  for (const c of calls ?? []) {
    const r = c.result as { title?: string; summary?: string; key_points?: string[] } | null
    const body = r ? [r.title, r.summary, ...(r.key_points ?? [])].filter(Boolean).join('\n') : String(c.transcript ?? '').slice(0, 4000)
    parts.push(`\n--- Call (${String(c.created_at).slice(0, 10)}${c.call_with ? `, with ${c.call_with}` : ''}) ---\n${body}`)
  }
  for (const e of emails ?? []) {
    const text = e.body_text ? ownText(String(e.body_text)).slice(0, 2500) : (e.summary ?? '')
    parts.push(`\n--- Email ${e.classification === 'sent' ? 'we sent' : `from ${e.from_email}`} (${String(e.received_at).slice(0, 10)}): ${e.subject ?? ''} ---\n${text}`)
  }
  if (deal.snapshot) parts.push(`\n--- Underwriting snapshot ---\n${snapshotToText(deal.snapshot as Snapshot).slice(0, 12000)}`)
  if (deal.borrower_profile) parts.push(`\n--- Borrower profile (from tax returns) ---\n${JSON.stringify(deal.borrower_profile).slice(0, 6000)}`)

  // Documents: the first pages of each (where addresses, totals and names
  // usually are), up to a budget.
  let budget = 60_000
  for (const d of (docs ?? []) as DocumentRecord[]) {
    if (budget <= 0) break
    try {
      const t = await getDocText(supabase, d)
      if (!t) continue
      const text = t.pages.slice(0, 4).map((p, i) => `[p.${i + 1}] ${p}`).join('\n').slice(0, Math.min(budget, 9000))
      if (!text.replace(/\[p\.\d+\]\s*/g, '').trim()) continue
      parts.push(`\n--- Document: ${d.file_name} ---\n${text}`)
      budget -= text.length
    } catch {
      // Unreadable file — skip it.
    }
  }

  const client = new Anthropic()
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 2500,
    messages: [{ role: 'user', content: `${GUIDE}\n\n${parts.filter(Boolean).join('\n')}` }],
    output_config: { effort: 'low', format: zodOutputFormat(Schema) },
  })
  await logUsage({ feature: 'key-facts', model: MODEL, dealId, usage: res.usage, supabase })
  if (!res.parsed_output) throw new Error('Could not read the key facts')

  // Keep anything edited by hand; it wins over the AI's version.
  const old = (deal.key_facts as KeyFacts | null)?.facts ?? []
  const pinned = old.filter((f) => f.pinned)
  const pinnedLabels = new Set(pinned.map((f) => f.label.toLowerCase()))
  const facts = [...pinned, ...res.parsed_output.facts.filter((f) => !pinnedLabels.has(f.label.toLowerCase()))]
  const missing = res.parsed_output.missing.filter((m) => !pinnedLabels.has(m.toLowerCase()))
  const result = { summary: res.parsed_output.summary, facts: facts.slice(0, Math.max(8, pinned.length)), missing: missing.slice(0, 3), v: KEY_FACTS_VERSION }
  await supabase.from('deals').update({ key_facts: result, key_facts_at: new Date().toISOString() }).eq('id', dealId)
  return result
}
