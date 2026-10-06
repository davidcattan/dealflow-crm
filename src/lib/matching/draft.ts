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

const COMMON_RULES = `You are writing a deal submission email from a commercial debt broker to a lender. This is a SALES email: its only job is to get the lender interested enough to reply or take a call. Lenders get dozens of these a day — lead with what makes the deal attractive to THIS lender and make it easy to say yes to a look.

Sell the deal:
- Lead with the strengths a lender cares about: hard collateral and its value, low loan-to-value, a clear and believable exit/repayment, the sponsor's plan, anything already approved or in place, and why the size/geography/product fits this lender's program.
- Frame the structure positively and honestly: e.g. "asset-based — repayment from lot sales" rather than listing what's missing.
- Mention a weakness ONLY if it changes whether this lender can do the deal at all (e.g. no income for a cash-flow lender, owner-occupied for a business-purpose-only lender). Say it once, briefly, as a structural fact, paired with the mitigant (e.g. "asset-based — no reliance on income; low LTV and lot-sale exit").
- The "flags", "request list" and coverage notes in the deal profile are the broker's INTERNAL diligence notes. Never repeat them: no overdrawn or drained accounts, no $0 income on personal returns, no audits, no "ordered by the occupant", no missing documents, no inconsistencies, no personal or family details, no tax IDs.
- Never write that something is unknown or "not yet stated". If the loan amount isn't given, write "[amount]" so the broker fills it in; leave out any other unknowns entirely.
- No filler or hype: no "I hope this finds you well", "I wanted to reach out", "great opportunity", "exciting". Confident, plain, specific.
- Use only facts and numbers given to you; never invent or inflate. Borrower projections (lot prices, after-improvement values) may be used but labeled as the sponsor's estimate.
- Use the borrower's entity name and sponsor's name; keep it professional.
- Sign off with "Best," and the sender's name.`

const STYLE_RULES: Record<DraftStyle, string> = {
  short: `SHORT style — under 120 words in the body:
- "Hi <first name>,"
- One sentence pitch: what the deal is (borrower type, location), the ask ([amount] if unknown), the collateral — written to make the lender want to read on.
- 2-4 bullet lines ("- ") with the strongest numbers (value, LTV, exit, anything approved).
- One sentence on why it fits THIS lender's program.
- Only if truly needed, one short structural line (e.g. "Asset-based — repayment from lot sales").
- One confident closing line asking for a quick call or their initial thoughts (mention the package is attached only if documents are attached).`,
  long: `LONG style — 180-260 words in the body, scannable:
- "Hi <first name>,"
- Two-sentence pitch: borrower and location, the ask ([amount] if unknown) and what it funds, the collateral, and the plan.
- "The deal:" followed by 4-6 bullet lines ("- "): collateral and value (with source, e.g. "appraised $573K, Mar 2026"), LTV, use of funds, the sponsor's plan and exit, anything already approved or in place, sponsor/borrower in one line.
- "Why it fits:" one or two sentences tying the deal to this lender's product, size range and geography.
- Optionally "Structure:" one line framing how it works (e.g. "Asset-based, 12–18 months with an interest reserve; repaid from lot sales").
- One confident closing line asking for a call or term sheet; if documents are attached, name the main kinds in a few words (e.g. "appraisal and site budget attached").`,
}

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
    // The model ends with "Best," (and maybe a name) — swap that for the signature.
    out = out.replace(/\n(best|regards|thanks|thank you|cheers)[,!]?\s*(\n[^\n]{0,40})?\s*$/i, '')
    out = `${out.trimEnd()}\n\nBest,\n${sender.signature}`
  }
  return out
}

export async function draftSubmissionEmail(
  dealId: string,
  lenderId: string,
  reasoning: string,
  style: DraftStyle = 'short',
  includeIntro = true
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
          `Sender's name for the sign-off: ${sender.name}`,
          includeIntro && sender.intro
            ? `--- Introduction ---\nThe sender's own introduction of themselves and their firm is inserted automatically right after the greeting. Do NOT introduce the sender or the firm yourself, and don't count it toward the word limit.`
            : `--- Introduction ---\nDon't introduce the sender or the firm — go straight to the deal.`,
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
