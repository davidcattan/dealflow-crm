import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { ownText } from '@/lib/outlook/own-text'

// Cheapest model: a 4-line follow-up from a few hundred words of context.
// About 0.1–0.3¢ per draft.
const MODEL = 'claude-haiku-5-5'

const RULES = `You write a short follow-up email from a debt broker (JED Capital Group) to a lender who hasn't answered about a deal the broker sent them.

Rules:
- 3 to 6 short lines of body. Casual-professional, like a busy banker writes. No "I hope this email finds you well", no "just checking in", no exclamation marks.
- Start with the greeting given. Then one line that you're following up on the deal (use the company name).
- Reiterate the 2-3 strongest points from what the broker ORIGINALLY SENT this lender (and the deal facts if the original email only said "see attached"). Use labeled lines the way the original did, e.g. "Revenue 2025: $2.9 million". Copy numbers exactly; never invent, round differently, or add a number that isn't in the material.
- If the original had an ASK line, end the recap with it ("ASK: $450,000").
- Only selling points. Never mention weaknesses, red flags, missing documents, declines from other lenders, or anything internal.
- If the lender already said something (e.g. "will review when back"), acknowledge it in a few words.
- If this is the second follow-up or later, ask plainly whether it's a fit, and that a quick no is fine.
- Close with one line offering a quick call or anything else they need, then "Thanks," on its own line. No name or signature after it.
- Output only the email body text. No subject line, no markdown, no bullets characters other than plain lines.`

type Input = {
  dealId: string
  lenderId: string
  dealName: string
  lenderName: string
  greeting: string
  followUpsSent: number
}

// Writes the follow-up body, or returns null if the AI call fails (the
// caller then falls back to a plain template).
export async function writeFollowUpEmail(supabase: SupabaseClient, input: Input): Promise<string | null> {
  const [{ data: sentRows }, { data: notes }, { data: deal }] = await Promise.all([
    // What we sent this lender, oldest first (the first one is the pitch).
    supabase
      .from('inbox_messages')
      .select('subject, body_text, received_at, classification')
      .eq('deal_id', input.dealId)
      .eq('lender_id', input.lenderId)
      .in('classification', ['sent', 'lender_reply'])
      .order('received_at', { ascending: true })
      .limit(8),
    supabase
      .from('deal_updates')
      .select('note, created_at')
      .eq('deal_id', input.dealId)
      .eq('lender_id', input.lenderId)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase.from('deals').select('description, deal_type, loan_type, key_facts').eq('id', input.dealId).single(),
  ])

  // The original pitch to this lender; if it wasn't to them directly, the
  // first pitch email on the deal.
  let original = (sentRows ?? []).find((m) => m.classification === 'sent')
  if (!original) {
    const { data } = await supabase
      .from('inbox_messages')
      .select('subject, body_text, received_at, classification')
      .eq('deal_id', input.dealId)
      .eq('classification', 'sent')
      .not('subject', 'ilike', 're:%')
      .order('received_at', { ascending: true })
      .limit(1)
    original = data?.[0]
  }
  const thread = (sentRows ?? [])
    .filter((m) => m !== original)
    .map((m) => `${m.classification === 'sent' ? 'We wrote' : 'They wrote'} (${String(m.received_at).slice(0, 10)}): ${ownText(m.body_text ?? '').slice(0, 600)}`)
  const facts = (deal?.key_facts as { summary?: string; facts?: { label: string; value: string }[] } | null) ?? null

  const context = [
    `Deal: ${input.dealName}`,
    `Lender: ${input.lenderName}`,
    `Greeting to use: ${input.greeting}`,
    `Follow-ups already sent to this lender since their last answer: ${input.followUpsSent}`,
    original
      ? `ORIGINAL EMAIL WE SENT (subject "${original.subject}"):\n${ownText(original.body_text ?? '').slice(0, 2500)}`
      : 'Original email: not on file.',
    thread.length ? `LATER EMAILS WITH THIS LENDER:\n${thread.join('\n')}` : null,
    notes?.length ? `NOTES ON THIS LENDER (newest first):\n${notes.map((n) => `- ${n.note}`).join('\n')}` : null,
    facts?.facts?.length
      ? `DEAL FACTS:\n${facts.summary ?? ''}\n${facts.facts.map((f) => `${f.label}: ${f.value}`).join('\n')}`
      : deal?.description
        ? `DEAL DESCRIPTION: ${deal.description}`
        : null,
  ]
    .filter(Boolean)
    .join('\n\n')

  try {
    const client = new Anthropic()
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: RULES,
      messages: [{ role: 'user', content: context }],
    })
    await logUsage({ feature: 'follow-up-draft', model: MODEL, dealId: input.dealId, usage: res.usage, supabase })
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      // The signature is added by the caller.
      .replace(/\n+(thanks|regards|best),?\s*\n[\s\S]*$/i, '\n\nThanks,')
    return text || null
  } catch (err) {
    console.error('Follow-up draft failed', err)
    return null
  }
}
