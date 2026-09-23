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

const DRAFT_INSTRUCTIONS = `You are an asset-based lending broker's assistant, drafting a deal submission email on the broker's behalf. The email introduces a specific borrower deal to a specific lender who is a strong, plausible fit for it. Write it exactly as the broker would send it to the lender's own contact.`

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

  const client = new Anthropic()

  const structured = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 4000,
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
            ? `--- Note ---\nThe following documents will be attached to this email automatically: ${documentNames.join(', ')}. You can reference that diligence materials are attached, but do not describe their contents beyond what's already in the deal profile above.`
            : `--- Note ---\nNo documents are uploaded for this deal yet — do not claim anything is attached.`,
          '',
          deal.rep_name ? `The broker sending this email is: ${deal.rep_name}` : '',
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
