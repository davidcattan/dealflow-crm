import type { SupabaseClient } from '@supabase/supabase-js'
import { ownText } from '@/lib/outlook/own-text'
import { mailboxOwner } from '@/lib/outlook/mailbox-label'

// Once a submission email on a deal has gone out, every other lender's
// draft copies the latest one word for word (so a reworded version sent to
// the second lender replaces the first): only the greeting name and the
// lender's name change. Free — no AI.

export type LatestPitch = {
  id: string
  subject: string
  body: string
  at: string
  lenderId: string
  lenderName: string | null
  senderName: string | null
}

const GREETING = /^(hi|hello|hey|dear|good morning|good afternoon)\b[^,\n]*,?/i
const SIGN_OFF = /^(best|regards|best regards|kind regards|warm regards|thanks|thank you|many thanks|cheers|sincerely)[,!.]?\s*$/i

// The latest fresh email (not a reply) the team sent a lender about this deal.
export async function loadLatestPitch(supabase: SupabaseClient, dealId: string): Promise<LatestPitch | null> {
  const { data } = await supabase
    .from('inbox_messages')
    .select('id, subject, body_text, received_at, mailbox, lender_id, lenders(name)')
    .eq('deal_id', dealId)
    .eq('classification', 'sent')
    .not('lender_id', 'is', null)
    .order('received_at', { ascending: false })
    .limit(20)
  for (const r of data ?? []) {
    const subject = (r.subject as string | null) ?? ''
    const body = r.body_text ? ownText(r.body_text as string) : ''
    if (/^\s*(re|fw|fwd)\s*:/i.test(subject) || body.length < 150) continue
    const lender = (Array.isArray(r.lenders) ? r.lenders[0] : r.lenders) as { name?: string } | null
    return {
      id: r.id as string,
      subject,
      body,
      at: r.received_at as string,
      lenderId: r.lender_id as string,
      lenderName: lender?.name ?? null,
      senderName: mailboxOwner(r.mailbox as string | null),
    }
  }
  return null
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function swapLender(text: string, from: string | null, to: string) {
  if (!from || from.trim().length < 3) return text
  return text.replace(new RegExp(escape(from.trim()), 'gi'), to)
}

// The subject a copied draft gets (to tell a copied draft apart on the page).
export function copiedSubject(pitch: Pick<LatestPitch, 'subject' | 'lenderName'>, lenderName: string) {
  return swapLender(pitch.subject.trim(), pitch.lenderName, lenderName)
}

// The pitch, re-addressed to another lender.
export function copyPitch(pitch: LatestPitch, to: { lenderName: string; contactFirstName: string | null; senderName?: string | null }) {
  const lines = swapLender(pitch.body, pitch.lenderName, to.lenderName).split('\n')

  // "Hi John," → "Hi Sarah," (or just "Hi," when we don't know their name).
  const g = lines.findIndex((l) => l.trim().length > 0)
  if (g >= 0 && GREETING.test(lines[g].trim())) {
    const word = lines[g].trim().match(/^(good morning|good afternoon|\w+)/i)![0]
    lines[g] = lines[g].trim().replace(GREETING, to.contactFirstName ? `${word} ${to.contactFirstName},` : `${word},`)
  }

  // Drop the sign-off and whatever signature followed it; sign it again.
  let end = lines.length
  for (let i = lines.length - 1; i > g; i--) {
    if (SIGN_OFF.test(lines[i].trim())) {
      end = i
      break
    }
  }
  const signOff = end < lines.length ? lines[end].trim() : 'Regards,'
  const name = to.senderName ?? pitch.senderName
  const body = `${lines.slice(0, end).join('\n').trimEnd()}\n\n${signOff}${name ? `\n${name}` : ''}`

  const subject = copiedSubject(pitch, to.lenderName)
  return { subject, body }
}

// Who to greet at a lender: the primary contact, else any contact with an email.
export async function lenderGreeting(supabase: SupabaseClient, lenderId: string) {
  const [{ data: lender }, { data: contacts }] = await Promise.all([
    supabase.from('lenders').select('name, contact_name, contact_email').eq('id', lenderId).single(),
    supabase.from('lender_contacts').select('name, email').eq('lender_id', lenderId),
  ])
  const primary = lender?.contact_email
    ? { name: lender.contact_name as string | null, email: lender.contact_email as string }
    : ((contacts ?? []).find((c) => c.email) ?? null)
  return {
    lenderName: (lender?.name as string | undefined) ?? 'your team',
    contactFirstName: primary?.name?.trim().split(/\s+/)[0] ?? null,
    contactName: primary?.name ?? null,
    contactEmail: primary?.email ?? null,
  }
}

// Right after a submission goes out: re-write every other lender's unsent
// draft on the deal to match it. Returns how many drafts changed.
export async function refreshDraftsFromLatestPitch(supabase: SupabaseClient, dealId: string) {
  const pitch = await loadLatestPitch(supabase, dealId)
  if (!pitch) return 0
  const [{ data: matches }, { data: subs }] = await Promise.all([
    supabase.from('deal_matches').select('id, lender_id').eq('deal_id', dealId).eq('draft_status', 'drafted'),
    supabase.from('deal_submissions').select('lender_id').eq('deal_id', dealId),
  ])
  const sentTo = new Set((subs ?? []).map((s) => s.lender_id as string))
  let changed = 0
  for (const m of matches ?? []) {
    if (m.lender_id === pitch.lenderId || sentTo.has(m.lender_id as string)) continue
    const to = await lenderGreeting(supabase, m.lender_id as string)
    const { subject, body } = copyPitch(pitch, to)
    const { error } = await supabase
      .from('deal_matches')
      .update({ draft_subject: subject, draft_body: body, draft_generated_at: new Date().toISOString() })
      .eq('id', m.id)
    if (!error) changed++
  }
  return changed
}
