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
import { LOAN_TYPE_CATEGORIES } from '@/lib/deals/categories'

// Cheap model: this is finding and copying facts, not judgment. ~1–3¢.
const MODEL = 'claude-haiku-5-5'

// Where a fact came from, so it can be opened: a document (and page), an
// email, a call, the notes, or the underwriting.
export type FactLink = { kind: 'doc' | 'email' | 'call' | 'notes' | 'snapshot'; id?: string; page?: number }
export type KeyFact = { label: string; value: string; source: string; note?: string; pinned?: boolean; link?: FactLink | null }
// v: the format version — older (wordier) key facts are re-read once.
export type LoanRecommendation = { loan_type: string; why: string }
// The deal's next step, decided by the AI from everything said and sent.
export const STEP_CATEGORIES = ['answer_lender', 'call_todo', 'borrower', 'send_out', 'everyone_passed', 'follow_up_lender', 'waiting_on_borrower', 'waiting_on_lender', 'done'] as const
export type AiNextStep = { text: string; category: (typeof STEP_CATEGORIES)[number] }
export type KeyFacts = { summary?: string; recommendation?: LoanRecommendation | null; next_step?: AiNextStep | null; facts: KeyFact[]; missing: string[]; v?: number }
export const KEY_FACTS_VERSION = 6

const Schema = z.object({
  summary: z
    .string()
    .describe(
      'What we know, in ONE sentence of at most 30 words — what the business/property is, the ask, and where it stands. e.g. "San Jose contract electronics maker, $4.6M revenue, wants a ~$400K ABL line to replace Huntington; financials in, waiting on credit and inventory list."'
    ),
  next_step: z
    .object({
      text: z
        .string()
        .describe('The single next thing that should happen on this deal, at most 15 words, specific: who and what. e.g. "Send Encina the inventory list they asked for Oct 14", "Borrower sending 2025 returns Friday — check Monday".'),
      category: z
        .enum(STEP_CATEGORIES)
        .describe(
          'answer_lender = a lender asked us something or is interested and we owe them a reply/call; call_todo = something we promised on a call; borrower = we need to ask/chase the borrower for docs or info; send_out = ready to underwrite, match or send to lenders; everyone_passed = all lenders declined, need new ones; follow_up_lender = we sent it and a lender has gone quiet 5+ days; waiting_on_borrower / waiting_on_lender = the ball is in their court and nothing is overdue; done = funded/closed/dead.'
        ),
    })
    .describe(
      'Read the latest emails, calls and notes: what was promised, asked or agreed most recently decides it. Newer beats older (emails show date and time). Before suggesting anything, check the team’s later emails ("we sent") and notes: if the team already did it — sent the signed NDA, the documents, the reply — it is done, so never suggest it again; pick the next open item instead.'
    ),
  recommendation: z
    .object({
      loan_type: z.enum(LOAN_TYPE_CATEGORIES).describe('The loan product that best fits what this borrower has and needs.'),
      why: z
        .string()
        .describe('At most 20 words, grounded in the facts: what collateral/cash flow supports it and why not the obvious alternative. e.g. "AR $910K + inventory $558K support a ~$400K line; EBITDA too thin for a cash-flow term loan."'),
    })
    .describe("A broker's recommendation of the best-fit loan type for this deal, from the facts found."),
  facts: z
    .array(
      z.object({
        label: z.string().describe('1–3 words: "Property address", "Revenue FY25", "AR", "Current lender".'),
        value: z
          .string()
          .describe('As short as possible — a number, a name or an address. "$4.6M", "$910K", "Huntington ($235K SBA)". No explanations, no parentheses beyond a few words.'),
        note: z.string().describe('Optional extra context in one short sentence (conflicting figures, breakdowns); "" if none.'),
        source: z.string().describe('2–4 words: "Tax returns", "Call 10/14", "Balance sheet 9/30", "Email from Mark".'),
        ref: z.string().describe('The [tag] of the section it came from, e.g. "D3", "E2", "C1", "NOTES", "SNAPSHOT"; "" if it came from the deal basics.'),
        page: z.number().describe('For a document, the page number it is on ([p.N]); 0 otherwise.'),
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
    supabase.from('deal_calls').select('id, created_at, transcript, result, call_with').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(6),
    supabase.from('inbox_messages').select('id, received_at, from_email, subject, summary, body_text, classification').eq('deal_id', dealId).order('received_at', { ascending: false }).limit(15),
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
  if ((updates ?? []).length) parts.push(`\n--- [NOTES] Notes / updates (newest first) ---\n${(updates ?? []).map((u) => `[${u.entry_date ?? ''}] ${u.note}`).join('\n')}`)
  const refs = new Map<string, FactLink>([['NOTES', { kind: 'notes' }], ['SNAPSHOT', { kind: 'snapshot' }]])
  for (const [i, c] of (calls ?? []).entries()) {
    refs.set(`C${i + 1}`, { kind: 'call', id: c.id as string })
    const r = c.result as { title?: string; summary?: string; key_points?: string[] } | null
    const body = r ? [r.title, r.summary, ...(r.key_points ?? [])].filter(Boolean).join('\n') : String(c.transcript ?? '').slice(0, 4000)
    parts.push(`\n--- [C${i + 1}] Call (${String(c.created_at).slice(0, 10)}${c.call_with ? `, with ${c.call_with}` : ''}) ---\n${body}`)
  }
  for (const [i, e] of (emails ?? []).entries()) {
    refs.set(`E${i + 1}`, { kind: 'email', id: e.id as string })
    const text = e.body_text ? ownText(String(e.body_text)).slice(0, 2500) : (e.summary ?? '')
    // Date and time (ET), so a reply sent later the same day reads as later.
    const when = new Date(String(e.received_at)).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    parts.push(`\n--- [E${i + 1}] Email ${e.classification === 'sent' ? 'we sent' : `from ${e.from_email}`} (${when}): ${e.subject ?? ''} ---\n${text}`)
  }
  if (deal.snapshot) parts.push(`\n--- [SNAPSHOT] Underwriting snapshot ---\n${snapshotToText(deal.snapshot as Snapshot).slice(0, 12000)}`)
  if (deal.borrower_profile) parts.push(`\n--- Borrower profile (from tax returns) ---\n${JSON.stringify(deal.borrower_profile).slice(0, 6000)}`)

  // Documents: the first pages of each (where addresses, totals and names
  // usually are), up to a budget.
  let budget = 60_000
  let docNo = 0
  for (const d of (docs ?? []) as DocumentRecord[]) {
    if (budget <= 0) break
    try {
      const t = await getDocText(supabase, d)
      if (!t) continue
      const text = t.pages.slice(0, 4).map((p, i) => `[p.${i + 1}] ${p}`).join('\n').slice(0, Math.min(budget, 9000))
      if (!text.replace(/\[p\.\d+\]\s*/g, '').trim()) continue
      docNo++
      refs.set(`D${docNo}`, { kind: 'doc', id: d.id })
      parts.push(`\n--- [D${docNo}] Document: ${d.file_name} ---\n${text}`)
      budget -= text.length
    } catch {
      // Unreadable file — skip it.
    }
  }

  const client = new Anthropic()
  const res = await client.messages.parse({
    model: MODEL,
    // Includes the model's thinking: at 2500 a third of runs hit the cap,
    // cutting the JSON off ("Unterminated string") or the reasoning short.
    max_tokens: 8000,
    messages: [{ role: 'user', content: `${GUIDE}\n\n${parts.filter(Boolean).join('\n')}` }],
    output_config: { effort: 'low', format: zodOutputFormat(Schema) },
  })
  await logUsage({ feature: 'key-facts', model: MODEL, dealId, usage: res.usage, supabase })
  if (!res.parsed_output) throw new Error('Could not read the key facts')

  // Keep anything edited by hand; it wins over the AI's version.
  const old = (deal.key_facts as KeyFacts | null)?.facts ?? []
  const pinned = old.filter((f) => f.pinned)
  const pinnedLabels = new Set(pinned.map((f) => f.label.toLowerCase()))
  const ai = res.parsed_output.facts.map(({ ref, page, ...f }) => {
    const base = refs.get(ref.trim().replace(/^\[|\]$/g, '').toUpperCase())
    return { ...f, link: base ? { ...base, ...(base.kind === 'doc' && page > 0 ? { page } : {}) } : null }
  })
  const facts = [...pinned, ...ai.filter((f) => !pinnedLabels.has(f.label.toLowerCase()))]
  const missing = res.parsed_output.missing.filter((m) => !pinnedLabels.has(m.toLowerCase()))
  const result = { summary: res.parsed_output.summary, recommendation: res.parsed_output.recommendation, next_step: res.parsed_output.next_step, facts: facts.slice(0, Math.max(8, pinned.length)), missing: missing.slice(0, 3), v: KEY_FACTS_VERSION }
  await supabase.from('deals').update({ key_facts: result, key_facts_at: new Date().toISOString() }).eq('id', dealId)
  return result
}

// Background catch-up (from the scheduled inbox job): re-read a few active
// deals whose key facts are missing, out of date, or older than their latest
// email / note / call / document. A few cents each; spreads out over runs.
export async function refreshStaleKeyFacts(supabase: SupabaseClient, limit = 8) {
  const { data: deals, error } = await supabase
    .from('deals')
    .select('id, key_facts, key_facts_at')
    .not('status', 'in', '(dead,closed,old)')
  if (error || !deals?.length) return 0
  const ids = deals.map((d) => d.id as string)
  const [{ data: emails }, { data: updates }, { data: docs }, { data: calls }] = await Promise.all([
    supabase.from('inbox_messages').select('deal_id, received_at').in('deal_id', ids).order('received_at', { ascending: false }).limit(3000),
    supabase.from('deal_updates').select('deal_id, created_at').in('deal_id', ids).order('created_at', { ascending: false }).limit(3000),
    supabase.from('documents').select('deal_id, uploaded_at').in('deal_id', ids),
    supabase.from('deal_calls').select('deal_id, created_at').in('deal_id', ids).eq('status', 'done'),
  ])
  const latest = new Map<string, string>()
  const bump = (id: string, at: string | null | undefined) => {
    if (at && (!latest.has(id) || at > latest.get(id)!)) latest.set(id, at)
  }
  for (const r of emails ?? []) bump(r.deal_id as string, r.received_at as string)
  for (const r of updates ?? []) bump(r.deal_id as string, r.created_at as string)
  for (const r of docs ?? []) bump(r.deal_id as string, r.uploaded_at as string)
  for (const r of calls ?? []) bump(r.deal_id as string, r.created_at as string)

  const due = deals
    .filter((d) => {
      const at = d.key_facts_at as string | null
      const v = (d.key_facts as { v?: number } | null)?.v ?? 0
      const last = latest.get(d.id as string)
      return !at || v < KEY_FACTS_VERSION || Boolean(last && last > at)
    })
    // Most recently active first: those are the ones on today's To do.
    .sort((a, b) => (latest.get(b.id as string) ?? '').localeCompare(latest.get(a.id as string) ?? ''))
    .slice(0, limit)
  let done = 0
  for (const d of due) {
    try {
      await buildKeyFacts(supabase, d.id as string)
      done++
    } catch {
      // One bad deal shouldn't stop the rest.
    }
  }
  return done
}
