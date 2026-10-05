import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { logUsage } from '@/lib/usage'
import { DraftEmailSchema, type DraftStyle } from './draft-schema'
import { buildDealProfile } from './deal-profile'
import type { Deal, DealUpdate } from '@/lib/types'

// Matches at or above this score get an auto-drafted submission email.
// Below this, it's more likely to be a marginal/speculative fit that a
// human should look over before any email gets written at all.
export const DRAFT_SCORE_THRESHOLD = 70

const COMMON_RULES = `You are writing a deal submission email from a commercial debt broker to a lender. Lenders get dozens of these a day, so get to the point: what the deal is, why it fits them, and a clear ask.

Always:
- No filler: no "I hope this finds you well", no "I wanted to reach out", no restating the lender's own mandate back to them, no hype words ("exciting", "unique", "great opportunity").
- Use only facts and numbers given to you; never invent or round in the borrower's favor.
- Be honest about deal-breakers (no income, owner-occupied, nonprofit borrower, etc.) — it saves everyone time.
- Sign off with "Best," and the sender's name.`

const STYLE_RULES: Record<DraftStyle, string> = {
  short: `SHORT style — under 120 words in the body:
- "Hi <first name>," (or "Hi there,")
- One sentence: borrower type and location, what they need, how much, secured by what.
- 2-4 bullet lines ("- ") with only the numbers a lender decides on (value, LTV, revenue/EBITDA, use of funds, exit).
- One sentence on why it fits THIS lender (their product, size or geography).
- Optional one line starting "Heads up:" only for an issue most lenders would reject on.
- One closing line asking for a quick look or call (mention the package is attached only if documents are attached).`,
  long: `LONG style — 200-300 words in the body, still tight and scannable:
- "Hi <first name>," (or "Hi there,")
- Two-sentence overview: who the borrower is, what they need, how much, secured by what, and the timing if known.
- "The deal:" followed by 5-8 bullet lines ("- "): borrower/ownership, amount and use of funds, collateral and value (with source, e.g. appraisal date), LTV if computable, financials (revenue/EBITDA/net income or cash flow — say plainly if there are none), repayment/exit, anything already approved or in place.
- "Why you:" one or two sentences tying the deal to this lender's product, size range and geography.
- "Things to know:" 1-3 bullet lines with the real issues and any mitigant that was given.
- One closing line asking for a call or term sheet; if documents are attached, name the main kinds in a few words (e.g. "appraisal, bank statements and tax return attached").`,
}

// Sign-off name: the deal's rep, else the first name of the connected
// Outlook mailbox (e.g. eli@… → "Eli"), else a placeholder.
async function senderName(supabase: Awaited<ReturnType<typeof createClient>>, repName: string | null) {
  if (repName) return repName
  const { data } = await supabase.from('outlook_connections').select('account_email').order('updated_at', { ascending: false }).limit(1).maybeSingle()
  const first = (data?.account_email ?? '').split('@')[0].split(/[._-]/)[0]
  return /^[a-z]{2,}$/i.test(first) ? first[0].toUpperCase() + first.slice(1).toLowerCase() : '[Your name]'
}

export async function draftSubmissionEmail(
  dealId: string,
  lenderId: string,
  reasoning: string,
  style: DraftStyle = 'short'
) {
  const supabase = await createClient()

  const [{ data: deal, error: dealError }, { data: updates }, { data: lender, error: lenderError }, { data: contacts }, { data: documents }] =
    await Promise.all([
      supabase.from('deals').select('*').eq('id', dealId).single(),
      supabase
        .from('deal_updates')
        .select('entry_date, note')
        .eq('deal_id', dealId)
        .order('entry_date', { ascending: false, nullsFirst: false })
        .limit(8),
      supabase.from('lenders').select('*').eq('id', lenderId).single(),
      supabase.from('lender_contacts').select('name, email').eq('lender_id', lenderId),
      supabase.from('documents').select('file_name').eq('deal_id', dealId),
    ])

  if (dealError || !deal) throw new Error('Deal not found')
  if (lenderError || !lender) throw new Error('Lender not found')

  const primaryContact =
    (contacts ?? []).find((c) => c.email) ??
    (lender.contact_email ? { name: lender.contact_name, email: lender.contact_email } : null)

  const dealProfile = buildDealProfile(
    deal as Deal,
    updates as Pick<DealUpdate, 'entry_date' | 'note'>[] | null
  )

  const lenderProfileParts = [
    `Lender: ${lender.name}`,
    lender.lending_type ? `Type: ${lender.lending_type}` : null,
    primaryContact?.name ? `Contact name: ${primaryContact.name}` : null,
    lender.mandate_notes ? `Mandate notes: ${lender.mandate_notes}` : null,
  ].filter(Boolean)

  const documentNames = (documents ?? []).map((d) => d.file_name)
  const sender = await senderName(supabase, deal.rep_name)

  const client = new Anthropic()

  const structured = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: [
          '--- Deal profile ---',
          dealProfile,
          '',
          '--- Lender being pitched ---',
          lenderProfileParts.join('\n'),
          '',
          '--- Why this lender was matched to this deal ---',
          reasoning,
          '',
          documentNames.length > 0
            ? `--- Attachments ---\nThe broker picks which of these to attach: ${documentNames.join(', ')}. Short style: just say "package attached". Long style: name the main kinds in a few words.`
            : `--- Attachments ---\nNothing is attached — don't mention attachments.`,
          '',
          `Sender's name for the sign-off: ${sender}`,
          COMMON_RULES,
          '',
          STYLE_RULES[style],
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    output_config: { format: zodOutputFormat(DraftEmailSchema) },
  })

  await logUsage({ feature: 'email-draft', model: 'claude-opus-5', dealId: dealId, usage: structured.usage })

  if (!structured.parsed_output) {
    throw new Error('Could not draft a submission email')
  }

  return {
    subject: structured.parsed_output.subject,
    body: structured.parsed_output.body,
    recipientEmail: primaryContact?.email ?? null,
    recipientName: primaryContact?.name ?? null,
    attachmentCount: documentNames.length,
  }
}
