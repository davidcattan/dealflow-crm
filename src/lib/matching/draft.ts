import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { logUsage } from '@/lib/usage'
import { DraftEmailSchema, type DraftStyle } from './draft-schema'
import { ownText } from '@/lib/outlook/own-text'
import { buildDealProfile } from './deal-profile'
import type { Deal, DealUpdate } from '@/lib/types'
import { skeletonEmail, type SkeletonSnapshot } from './skeleton'
import { copyPitch, lenderGreeting, loadLatestPitch } from './copy-sent'

// Matches at or above this score get an auto-drafted submission email.
// Below this, it's more likely to be a marginal/speculative fit that a
// human should look over before any email gets written at all.
export const DRAFT_SCORE_THRESHOLD = 70

const COMMON_RULES = `You are writing a deal submission email from a commercial debt broker to a lender. This is a SALES email: its only job is to get the lender interested enough to reply or take a call. Lenders get dozens of these a day — lead with what makes the deal attractive to THIS lender and make it easy to say yes to a look.

Sell the deal:
- Lead with the strengths a lender cares about: hard collateral and its value, low loan-to-value, a clear and believable exit/repayment, the sponsor's plan, anything already approved or in place, and why the size/geography/product fits this lender's program.
- Frame the structure positively and honestly: e.g. "asset-based — repayment from lot sales" rather than listing what's missing.
- Mention a weakness ONLY if it changes whether this lender can do the deal at all (e.g. no income for a cash-flow lender, owner-occupied for a business-purpose-only lender). Say it once, briefly, as a structural fact, paired with the mitigant (e.g. "asset-based — no reliance on income; low LTV and lot-sale exit").
- The "flags", "request list" and coverage notes in the deal profile are the broker's INTERNAL diligence notes. Never repeat them: no overdrawn or drained accounts, no $0 income on personal returns, no audits, no "ordered by the occupant", no missing documents, no inconsistencies, no personal or family details, no tax IDs.
- Never write that something is unknown or "not yet stated". If the loan amount isn't given, write "[amount]" so the broker fills it in; leave out any other unknowns entirely.
- No hype: no "I wanted to reach out", "great opportunity", "exciting". Confident, plain, specific. (The one-line "hope all is well" opener in the house format is fine.)
- Use only facts and numbers given to you; never invent or inflate. Borrower projections (lot prices, after-improvement values) may be used but labeled as the sponsor's estimate.
- Use the borrower's entity name and sponsor's name; keep it professional.
- Sign off with "Regards," and the sender's first name.`

// The team's house format (how Eli writes): greeting, one paragraph on the
// company, then the numbers as short labeled blocks — no bullets — then the
// ask and a one-line close. Example:
//   Hi Tom, hope all is well.
//
//   I'm working with Orbit Innovations, a New York City based wholesale and
//   manufacturing company that turns licensed IP … selling into Target,
//   Walmart and Amazon.
//
//   Revenue
//   2025: $29.6 million
//   2026 Year to Date (July): $8.0 million
//
//   EBITDA
//   2025: $1.8 million
//
//   AR: $4.1 million
//   Inventory on Hand: $3.6 million
//
//   Debt: Hedaya Group (factor): $6.3 million
//
//   ASK: Client needs an ABL lender to replace Hedaya Group.
//
//   Let me know if you have time to discuss briefly.
//
//   Regards,
//   Eli
const HOUSE_FORMAT = `Write it in the team's house format, exactly in this shape (plain text, no bullet points, no bold, no section headers other than the labels shown):

Hi <first name>, hope all is well.

I'm working with <Company>, a <City/State> based <what the business does, in plain words — products, customers or markets that make it credible>.

Revenue
<year>: $<x> million
<year> Year to Date (<month>): $<x> million

EBITDA
<year>: $<x> million

AR: $<x>
Inventory: $<x>   (split "on Hand" / "in Transit" if known)
Equipment: $<x>
Real Estate: $<x>

Debt: <Lender> (<type>): $<x>

ASK: <one sentence — what the client needs, the amount ([amount] if unknown) and the product, e.g. "Client needs an ABL lender to replace Hedaya Group.">

<attachments line, only if documents are attached: "Package attached.">

Let me know if you have time to discuss briefly.

Regards,
<sender's first name>

Rules for the format:
- Include only the blocks that have real numbers; skip the rest entirely (no empty labels, no "N/A").
- Amounts: "$29.6 million" for millions, "$850K" for thousands. Newest year first within Revenue and EBITDA.
- Real estate / asset-heavy deals without operating financials: replace Revenue/EBITDA with the property facts in the same labeled style (e.g. "Property: 5.42 acres with existing home, Flowery Branch, GA", "Appraised Value: $573K (March 2026)", "Loan to Value: 40%").
- At most one short neutral note in parentheses after a number when it explains it (e.g. "(lost orders Q1 2026)"); never internal diligence flags.`

// Personal and real-estate deals (a HELOC, a bridge on a house) have no
// company revenue/EBITDA, so the AI writes those in the same layout with the
// facts that matter for that loan instead.
const AI_RULES = `${HOUSE_FORMAT}

Keep the opening paragraph to one or two sentences and include only the numbers that matter to this lender.
LOANS SECURED BY PROPERTY (HELOC, home equity, second lien, bridge, real estate): the property is the story. Use labeled lines for the property and its location, its value, the existing mortgage(s) (and whether they stay in place), the loan request and lien position, combined loan-to-value, and what covers the payment (rent, income) if known. Add the borrower's credit or income only when it decides whether this lender can do it, next to the mitigant (e.g. low LTV). No Revenue/EBITDA/AR/Inventory blocks. If a business borrows against the owner's property for business purposes, open with the company ("I'm working with <Company>, a <City> based <business>.") and say it is a business-purpose loan; for a purely personal loan say "I'm working with a client" (or the borrower's name).
Layout (fill with this deal's facts; skip lines you don't have):
Property: <address, city, state> (<rental / primary home / land…>)
Estimated Value: ~$<x>
1st Mortgage: ~$<x> at <rate> (staying in place)

Loan Request: $<x>, <first / second> lien
Combined LTV: ~<x>%
<what covers the payment, e.g. "Rental income covers the new payment">

ASK: <one sentence: amount, product, lien position, LTV>.
Use the newest numbers: the latest deal summary and activity log win over older documents (e.g. a newer estimated value).`

type Sender = { name: string; intro: string | null; signature: string | null }

function firstNameFromEmail(email: string) {
  const first = email.split('@')[0].split(/[._-]/)[0]
  return /^[a-z]{2,}$/i.test(first) ? first[0].toUpperCase() + first.slice(1).toLowerCase() : null
}

// Who's sending: the signed-in user's connected mailbox (the one drafts go
// to), else the newest mailbox. Its intro and signature come from Settings.
async function loadSender(supabase: Awaited<ReturnType<typeof createClient>>, repName: string | null): Promise<Sender> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data } = await supabase
    .from('outlook_connections')
    .select('*')
    .order('created_at', { ascending: false })
  const rows = (data ?? []) as { account_email: string; connected_by: string | null; email_intro?: string | null; email_signature?: string | null }[]
  const mine = rows.find((r) => r.connected_by === user?.id) ?? rows[0]
  const name = (mine && firstNameFromEmail(mine.account_email)) || repName || '[Your name]'
  return {
    name,
    intro: mine?.email_intro?.trim() || null,
    signature: mine?.email_signature?.trim() || null,
  }
}

// Puts the sender's intro right after the greeting line, and their
// signature after the sign-off — exactly as written in Settings.
function applyIntroAndSignature(body: string, sender: Sender, includeIntro: boolean) {
  let out = body.trim()
  if (includeIntro && sender.intro) {
    const lines = out.split('\n')
    const greeting = lines.findIndex((l) => l.trim().length > 0)
    if (greeting >= 0 && /^(hi|hello|dear|good)\b/i.test(lines[greeting].trim())) {
      lines.splice(greeting + 1, 0, '', sender.intro)
      out = lines.join('\n').replace(/\n{3,}/g, '\n\n')
    } else {
      out = `${sender.intro}\n\n${out}`
    }
  }
  if (sender.signature) {
    // The skeleton ends with "Regards," and a first name — swap the name for the signature.
    out = out.replace(/\n(best|regards|thanks|thank you|cheers)[,!]?\s*(\n[^\n]{0,40})?\s*$/i, '')
    out = `${out.trimEnd()}\n\nRegards,\n${sender.signature}`
  }
  return out
}

const PROPERTY_LOANS = ['HELOC / Home Equity', 'Real Estate / Bridge', 'Construction Financing']

// The lender email. Default ('auto'): once a submission on this deal has
// been sent, the same email word for word, re-addressed to this lender;
// before that ('skeleton'), the team's fixed skeleton (Eli's format) filled
// with this deal's numbers — no AI, free and instant either way. Loans
// against property (HELOC, bridge…) skip the skeleton and go to the AI.
// 'ai': written by the AI in the same house format, for deals the skeleton
// doesn't fit (personal loans like a HELOC, real estate) — a few cents.
export async function draftSubmissionEmail(
  dealId: string,
  lenderId: string,
  reasoning = '',
  style: DraftStyle = 'auto',
  includeIntro = true,
  revise?: Revision
) {
  if (style === 'ai' || revise) return draftWithAi(dealId, lenderId, reasoning, includeIntro, revise)
  const supabase = await createClient()

  if (style === 'auto' || style === 'copy') {
    const pitch = await loadLatestPitch(supabase, dealId)
    // Nothing sent yet on a loan against property: the business skeleton
    // (revenue, EBITDA, AR, inventory) doesn't fit, so the AI writes it in
    // the same format with the property numbers.
    if (!pitch && style === 'auto') {
      const { data: d } = await supabase.from('deals').select('loan_type').eq('id', dealId).single()
      if (PROPERTY_LOANS.includes(String(d?.loan_type ?? ''))) return draftWithAi(dealId, lenderId, reasoning, includeIntro)
    }
    if (pitch && pitch.lenderId !== lenderId) {
      const [to, { data: deal }, { data: documents }] = await Promise.all([
        lenderGreeting(supabase, lenderId),
        supabase.from('deals').select('rep_name').eq('id', dealId).single(),
        supabase.from('documents').select('file_name').eq('deal_id', dealId),
      ])
      const sender = await loadSender(supabase, (deal?.rep_name as string | null) ?? null)
      const { subject, body } = copyPitch(pitch, { ...to, senderName: sender.name })
      return {
        subject,
        // The first email already has its own intro; only the signature is re-applied.
        body: applyIntroAndSignature(body, sender, false),
        recipientEmail: to.contactEmail,
        recipientName: to.contactName,
        attachmentCount: (documents ?? []).length,
      }
    }
  }

  const [{ data: deal, error: dealError }, { data: lender, error: lenderError }, { data: contacts }, { data: documents }] = await Promise.all([
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase.from('lenders').select('*').eq('id', lenderId).single(),
    supabase.from('lender_contacts').select('name, email').eq('lender_id', lenderId),
    supabase.from('documents').select('file_name').eq('deal_id', dealId),
  ])
  if (dealError || !deal) throw new Error('Deal not found')
  if (lenderError || !lender) throw new Error('Lender not found')

  // Greet the primary contact (the "To" on the Outlook draft).
  const primaryContact = lender.contact_email
    ? { name: lender.contact_name as string | null, email: lender.contact_email as string }
    : ((contacts ?? []).find((c) => c.email) ?? null)

  const sender = await loadSender(supabase, deal.rep_name)
  const profile = deal.borrower_profile as { company?: { city?: { value: string | null }; state?: { value: string | null } } } | null
  const location = [profile?.company?.city?.value, profile?.company?.state?.value].filter(Boolean).join(', ') || null

  const { subject, body } = skeletonEmail({
    companyName: deal.company_name,
    description: deal.description,
    location,
    loanType: deal.loan_type,
    ask: deal.deal_type,
    snapshot: deal.snapshot as SkeletonSnapshot,
    contactFirstName: primaryContact?.name?.trim().split(/\s+/)[0] ?? null,
    senderFirstName: sender.name,
  })

  return {
    subject,
    body: applyIntroAndSignature(body, sender, includeIntro),
    recipientEmail: primaryContact?.email ?? null,
    recipientName: primaryContact?.name ?? null,
    attachmentCount: (documents ?? []).length,
  }
}

// The broker's own fix-up request on an existing draft ("just total debt,
// don't break down the three clinics"): the AI edits that draft.
export type Revision = { instructions: string; subject: string; body: string }

async function draftWithAi(
  dealId: string,
  lenderId: string,
  reasoning: string,
  includeIntro: boolean,
  revise?: Revision
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

  // Greet the primary contact (the "To" on the Outlook draft).
  const primaryContact = lender.contact_email
    ? { name: lender.contact_name, email: lender.contact_email }
    : ((contacts ?? []).find((c) => c.email) ?? null)

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
  const sender = await loadSender(supabase, deal.rep_name)

  // What the broker actually sent lenders (from the Sent folders): the
  // latest pitch on THIS deal is the model for every other lender's draft;
  // a couple from other deals show the broker's own voice.
  const [{ data: dealSends }, { data: otherSends }] = await Promise.all([
    supabase
      .from('inbox_messages')
      .select('body_text, received_at, lender_id, lenders(name)')
      .eq('deal_id', dealId)
      .eq('classification', 'sent')
      .not('lender_id', 'is', null)
      .neq('lender_id', lenderId)
      .order('received_at', { ascending: false })
      .limit(1),
    supabase
      .from('inbox_messages')
      .select('body_text')
      .eq('classification', 'sent')
      .not('lender_id', 'is', null)
      .neq('deal_id', dealId)
      .order('received_at', { ascending: false })
      .limit(2),
  ])
  const pitch = dealSends?.[0]
  const pitchText = pitch?.body_text ? ownText(pitch.body_text).slice(0, 3500) : null
  const pitchLender = pitch ? ((Array.isArray(pitch.lenders) ? pitch.lenders[0] : pitch.lenders) as { name?: string } | null)?.name : null
  const styleExamples = (otherSends ?? [])
    .map((r) => (r.body_text ? ownText(r.body_text).slice(0, 1200) : ''))
    .filter((t) => t.length > 80)

  const client = new Anthropic()

  const structured = await client.messages.parse({
    model: 'claude-opus-5-5',
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
          pitchText
            ? `--- The broker's own email to ${pitchLender ?? 'another lender'} about this deal (sent ${String(pitch?.received_at ?? '').slice(0, 10)}) ---\n${pitchText}\n\nThis is how the broker actually pitched THIS deal. Keep its facts, numbers and framing, including any corrections it makes to the deal profile (the broker's email is newer and wins any conflict), but lay it out in the house format below. Change only what is specific to this lender, and keep it a fresh email, not a forward. The selling rules above still apply: leave out internal diligence details even if that email included them.`
            : null,
          styleExamples.length
            ? `--- Examples of the broker's writing on other deals (match the voice only — the layout is the house format below; don't copy their facts) ---\n${styleExamples.join('\n---\n')}`
            : null,
          `Sender's name for the sign-off: ${sender.name}`,
          includeIntro && sender.intro
            ? `--- Introduction ---\nThe sender's own introduction of themselves and their firm is inserted automatically right after the greeting. Do NOT introduce the sender or the firm yourself, and don't count it toward the word limit.`
            : `--- Introduction ---\nDon't introduce the sender or the firm — go straight to the deal.`,
          COMMON_RULES,
          '',
          AI_RULES,
          revise ? revisionPrompt(revise, sender) : null,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    output_config: { format: zodOutputFormat(DraftEmailSchema) },
  })

  await logUsage({ feature: 'email-draft', model: 'claude-opus-5-5', dealId: dealId, usage: structured.usage })

  if (!structured.parsed_output) {
    throw new Error('Could not draft a submission email')
  }

  return {
    subject: structured.parsed_output.subject,
    body: applyIntroAndSignature(structured.parsed_output.body, sender, includeIntro),
    recipientEmail: primaryContact?.email ?? null,
    recipientName: primaryContact?.name ?? null,
    attachmentCount: documentNames.length,
  }
}

// The current draft (without the intro/signature we add back ourselves) and
// the broker's requested changes, which win over the format rules.
function revisionPrompt(revise: Revision, sender: Sender) {
  let body = revise.body
  for (const part of [sender.signature, sender.intro]) if (part) body = body.replace(part, '')
  body = body.replace(/\n(best|regards|thanks|thank you|cheers)[,!]?\s*(\n[^\n]{0,40})?\s*$/i, '').trim()
  return [
    '',
    '--- The current draft ---',
    `Subject: ${revise.subject}`,
    '',
    body,
    '',
    "--- The broker's changes (follow these exactly — they override the format rules above) ---",
    revise.instructions,
    '',
    'Rewrite the current draft with these changes. Keep everything they don\'t mention as it is (same facts, wording and layout); change only what they ask for.',
  ].join('\n')
}
