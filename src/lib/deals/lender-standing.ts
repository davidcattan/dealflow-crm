import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { INBOX_MODEL } from '@/lib/inbox/classify'
import { headAndTail, ownText } from '@/lib/outlook/own-text'
import { SUBMISSION_LABELS, SUBMISSION_STATUSES, type SubmissionStatus } from '@/lib/deals/submission-status'
import type { KeyFacts } from '@/lib/deals/key-facts'

// Where a lender stands on a deal, decided the way a person would: by
// reading the WHOLE conversation with that lender (both sides, in order,
// including emails filed on other deals), the deal's facts and the team's
// own notes — not by judging the latest email on its own. Nov 23, 2026:
// David wants "Lenders sent to" right on every deal without anyone
// tracking it by hand. Same model as the inbox reader (no upgrade).

const Schema = z.object({
  status: z.enum(SUBMISSION_STATUSES),
  reason: z.string().describe('One short sentence: why this is the status now, citing what the lender (or the team) said.'),
})

const INSTRUCTIONS = `You are an experienced debt broker at JED Capital Group (David Cattan and Eli Cattan). Below is everything we have between JED and one lender, plus what we know about one deal. Decide where this lender stands on THIS deal right now — the way you would if a colleague showed you the thread and asked "are they still in?"

Statuses:
- sent: we pitched it and they haven't really responded about this deal yet (or only scheduling, NDA paperwork, out-of-office, "got it").
- interested: they want to look further — reviewing, want a call or the data room, positive and still engaged.
- needs_more_info: they are engaged and waiting on something specific from us (documents or answers) to move forward.
- term_sheet: they issued a term sheet, proposal letter, LOI or indicative terms for this deal that hasn't been withdrawn.
- declined: they are out on this deal.
- funded: the loan closed with them.

How to judge:
- Judge ONLY the deal named below. Emails marked as filed on another deal, or that are about another deal, are context only: a pass on another deal is not a pass on this one, and interest in another deal is not interest in this one. In a thread that covers two deals, work out which parts are about this deal.
- Read the whole conversation in order; the newest relevant message usually decides, but read it in light of what came before and of what JED wrote back.
- They are OUT (declined) when they pass in any wording ("not a fit", "would not work", "not a space we're in", "too small", "can't do NY Medicaid") — and also when they said they can only proceed with something this deal can't give (a cash sweep, dominion, a guarantee, a size or EBITDA minimum, a structure) and the deal facts or JED's replies show the borrower won't or can't (e.g. JED says "we couldn't get him to move on the sweep"). A conditional "can't move forward if X" plus X being true is a pass.
- A lender that passed and later re-engaged on this same deal (asked for more, sent terms) is back in.
- When someone only introduces the deal to a person at a DIFFERENT firm, that interest belongs to the other firm, not to this lender.
- Team notes (typed by David or Eli, and call notes) count as much as emails and are often the newest word — e.g. "spoke to him, they're out" or "Status changed to Declined." A status the team set by hand stands unless something newer clearly changes it.
- If nothing meaningful came back yet, it's sent.`

type Line = { at: string; text: string }

// The email being filed right now, in case it isn't saved (or tied to the
// lender) yet when the conversation is read.
export type CurrentEmail = {
  receivedAt: string
  sent: boolean
  from: string | null
  to: string | null
  subject: string | null
  body: string | null
}

function clip(text: string | null | undefined, max: number) {
  return headAndTail(ownText(String(text ?? '')).replace(/\n{3,}/g, '\n\n'), max)
}

// The material the AI reads. Returns null when there's no conversation at
// all (nothing to judge — leave the status alone).
async function gather(supabase: SupabaseClient, dealId: string, lenderId: string, current?: CurrentEmail) {
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: deal }, { data: lender }, { data: sub }, { data: emails }, { data: notes }, { data: deals }] = await Promise.all([
    supabase.from('deals').select('id, company_name, deal_type, description, notes, key_facts').eq('id', dealId).single(),
    supabase.from('lenders').select('id, name').eq('id', lenderId).single(),
    supabase.from('deal_submissions').select('id, status').eq('deal_id', dealId).eq('lender_id', lenderId).maybeSingle(),
    supabase
      .from('inbox_messages')
      .select('received_at, classification, from_email, to_emails, subject, body_text, summary, deal_id')
      .eq('lender_id', lenderId)
      .in('classification', ['sent', 'lender_reply', 'other'])
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(40),
    supabase
      .from('deal_updates')
      .select('entry_date, note, source, created_at')
      .eq('deal_id', dealId)
      .eq('lender_id', lenderId)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase.from('deals').select('id, company_name'),
  ])
  if (!deal || !lender || !sub) return null
  const dealName = new Map((deals ?? []).map((d) => [d.id as string, d.company_name as string]))

  const lines: Line[] = []
  const rows = [...(emails ?? [])]
  if (current && !rows.some((e) => String(e.received_at).slice(0, 19) === current.receivedAt.slice(0, 19) && e.subject === current.subject))
    rows.push({
      received_at: current.receivedAt,
      classification: current.sent ? 'sent' : 'lender_reply',
      from_email: current.from,
      to_emails: current.to,
      subject: current.subject,
      body_text: current.body,
      summary: null,
      deal_id: dealId,
    })
  for (const e of rows) {
    const filed = e.deal_id === dealId ? 'filed on THIS deal' : e.deal_id ? `filed on another deal: ${dealName.get(e.deal_id) ?? 'unknown'}` : 'not filed on a deal'
    const who = e.classification === 'sent' ? `JED → ${e.to_emails ?? lender.name}` : `${e.from_email} (${lender.name}) → JED`
    lines.push({
      at: String(e.received_at),
      text: `[${String(e.received_at).slice(0, 10)}] EMAIL ${who} — "${e.subject ?? ''}" (${filed})\n${clip(e.body_text ?? e.summary, 1800)}`,
    })
  }
  for (const n of notes ?? []) {
    // The inbox's own "Lender reply — …" entries repeat the emails above.
    if (n.source === 'email') continue
    lines.push({ at: String(n.created_at), text: `[${n.entry_date ?? String(n.created_at).slice(0, 10)}] TEAM NOTE: ${n.note}` })
  }
  if (lines.length === 0) return null
  lines.sort((a, b) => a.at.localeCompare(b.at))

  const kf = deal.key_facts as KeyFacts | null
  const facts = [
    `Deal: ${deal.company_name}${deal.deal_type ? ` (${deal.deal_type})` : ''}`,
    kf?.summary ? `Summary: ${kf.summary}` : null,
    kf?.facts?.length ? `Key facts: ${kf.facts.map((f) => `${f.label}: ${f.value}`).join(' | ')}` : null,
    deal.description ? `Description: ${headAndTail(String(deal.description), 1500)}` : null,
    deal.notes ? `Deal notes: ${headAndTail(String(deal.notes), 2500)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  // Newest material matters most; trim the oldest if it's very long.
  let convo = lines.map((l) => l.text).join('\n\n')
  if (convo.length > 40000) convo = `…(older messages cut)…\n${convo.slice(-40000)}`
  return { deal, lender, sub: sub as { id: string; status: SubmissionStatus }, facts, convo }
}

export type StandingResult = { changed: boolean; from: SubmissionStatus; to: SubmissionStatus; reason: string } | null

// Re-reads one lender's conversation about one deal and updates the
// lender's status on "Lenders sent to" if it's different. Logs the change
// (and why) on the deal. Returns null when there was nothing to read.
export async function judgeLenderStanding(
  supabase: SupabaseClient,
  dealId: string,
  lenderId: string,
  current?: CurrentEmail
): Promise<StandingResult> {
  const g = await gather(supabase, dealId, lenderId, current)
  if (!g) return null

  const client = new Anthropic()
  const read = () =>
    client.messages.parse({
      model: INBOX_MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            INSTRUCTIONS,
            '',
            '--- The deal ---',
            g.facts,
            '',
            `--- Everything between JED and ${g.lender.name} (oldest first) ---`,
            g.convo,
            '',
            `Current status in the CRM: ${SUBMISSION_LABELS[g.sub.status] ?? g.sub.status}.`,
            `Where does ${g.lender.name} stand on ${g.deal.company_name} now?`,
          ].join('\n'),
        },
      ],
      output_config: { effort: 'medium', format: zodOutputFormat(Schema) },
    })
  const res = await read().catch((err) => {
    if (err instanceof Error && /Failed to parse structured output/.test(err.message)) return read()
    throw err
  })
  await logUsage({ feature: 'lender-standing', model: INBOX_MODEL, dealId, usage: res.usage, supabase })
  const out = res.parsed_output
  if (!out) return null

  const from = g.sub.status
  const to = out.status
  if (to !== from) {
    await supabase.from('deal_submissions').update({ status: to }).eq('id', g.sub.id)
    await supabase.from('deal_updates').insert({
      deal_id: dealId,
      lender_id: lenderId,
      entry_date: new Date().toISOString().slice(0, 10),
      note: `${g.lender.name}: ${SUBMISSION_LABELS[from] ?? from} → ${SUBMISSION_LABELS[to]}. ${out.reason}`,
      source: 'email',
    })
  }
  return { changed: to !== from, from, to, reason: out.reason }
}

// Same, never throwing — for the inbox sync, where a failed read must not
// stop the email from being filed (the per-email status stays as it was).
export async function judgeLenderStandingSafe(supabase: SupabaseClient, dealId: string, lenderId: string, current?: CurrentEmail) {
  try {
    return await judgeLenderStanding(supabase, dealId, lenderId, current)
  } catch (err) {
    console.error('Lender standing read failed', err)
    return null
  }
}
