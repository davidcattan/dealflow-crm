import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { DraftStyle } from './draft-schema'
import { skeletonEmail, type SkeletonSnapshot } from './skeleton'

// Matches at or above this score get an auto-drafted submission email.
// Below this, it's more likely to be a marginal/speculative fit that a
// human should look over before any email gets written at all.
export const DRAFT_SCORE_THRESHOLD = 70

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

// The lender email: the team's fixed skeleton (Eli's format) filled with
// this deal's numbers — no AI, so it's free, instant and the same every
// time. `reasoning` and `style` are kept for the callers' signature.
export async function draftSubmissionEmail(
  dealId: string,
  lenderId: string,
  _reasoning?: string,
  _style?: DraftStyle,
  includeIntro = true
) {
  const supabase = await createClient()

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
