import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { logUsage } from '@/lib/usage'
import { DraftEmailSchema } from './draft-schema'
import { buildDealProfile } from './deal-profile'
import type { Deal, DealUpdate } from '@/lib/types'

// Matches at or above this score get an auto-drafted submission email.
// Below this, it's more likely to be a marginal/speculative fit that a
// human should look over before any email gets written at all.
export const DRAFT_SCORE_THRESHOLD = 70

const DRAFT_INSTRUCTIONS = `You are writing a deal submission email from a commercial debt broker to a lender. Lenders get dozens of these a day — the email must be short and get to the point: what the deal is, why it fits them, and a clear ask.

Rules:
- Under 120 words in the body. Short sentences. Bullets for numbers.
- No filler: no "I hope this finds you well", no "I wanted to reach out", no restating the lender's own mandate back to them, no adjectives like "exciting" or "unique".
- Lead with the deal in one sentence: who the borrower is (type, location), what they need, how much, secured by what.
- Bullets: only the 2-4 facts a lender decides on (value, LTV, revenue/EBITDA, use of funds, exit). Use only numbers given to you; never invent or round in the borrower's favor.
- Why them: one sentence tying the deal to this lender's product, size range or geography.
- If there is a known problem most lenders would reject on (no income, owner-occupied, nonprofit borrower, etc.), say it in one honest line starting "Heads up:" — it saves everyone time.
- Close with one line asking them to take a look or jump on a quick call. Mention the package is attached only if documents are attached.
- Sign off with "Best," and the sender's name.
- Use the borrower's company name, not the individual's personal details beyond what a lender needs.`

// Sign-off name: the deal's rep, else the first name of the connected
// Outlook mailbox (e.g. eli@… → "Eli"), else a placeholder.
async function senderName(supabase: Awaited<ReturnType<typeof createClient>>, repName: string | null) {
  if (repName) return repName
  const { data } = await supabase.from('outlook_connections').select('account_email').order('updated_at', { ascending: false }).limit(1).maybeSingle()
  const first = (data?.account_email ?? '').split('@')[0].split(/[._-]/)[0]
  return /^[a-z]{2,}$/i.test(first) ? first[0].toUpperCase() + first.slice(1).toLowerCase() : '[Your name]'
}

export async function draftSubmissionEmail(dealId: string, lenderId: string, reasoning: string) {
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
    max_tokens: 2000,
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
            ? `--- Attachments ---\n${documentNames.length} documents will be attached automatically. Say "package attached" — don't list the files.`
            : `--- Attachments ---\nNothing is attached — don't mention attachments.`,
          '',
          `Sender's name for the sign-off: ${sender}`,
          DRAFT_INSTRUCTIONS,
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
