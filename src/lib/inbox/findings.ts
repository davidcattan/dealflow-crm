import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { InboxMessage } from '@/lib/outlook/graph'
import type { EmailClassification } from './classify-schema'
import { isTeamName } from './partners'
import { normalizeName, parseSignature } from './signature'

const TEAM_EMAIL = /@(jed-capitalgroup|jedcapital-group|jedcapitalgrp)\.com$/i
const looksLikeEmail = (s: string | null | undefined) => Boolean(s && s.includes('@'))
const blank = (s: string | null | undefined) => !s || !s.trim()
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')

export type Person = {
  name: string
  firm?: string | null
  title?: string | null
  email?: string | null
  phone?: string | null
}

// Fills in only what's empty. Never overwrites anything a person typed.
async function fillContact(
  supabase: SupabaseClient,
  email: string,
  info: { name?: string | null; title?: string | null; phone?: string | null }
) {
  const { data: rows } = await supabase
    .from('lender_contacts')
    .select('id, name, title, phone')
    .ilike('email', escapeLike(email))
  for (const row of rows ?? []) {
    const patch: Record<string, string> = {}
    if (info.phone && blank(row.phone)) patch.phone = info.phone
    if (info.title && blank(row.title)) patch.title = info.title
    if (info.name && !looksLikeEmail(info.name) && (blank(row.name) || looksLikeEmail(row.name))) patch.name = info.name
    if (Object.keys(patch).length) await supabase.from('lender_contacts').update(patch).eq('id', row.id)
  }
  return rows?.length ?? 0
}

// Free (no AI): reads the sender's phone and title from their signature and
// fills the blanks on their contact records. Must never stop an email from
// being processed, so the caller ignores any failure.
export async function learnFromSignature(supabase: SupabaseClient, message: InboxMessage) {
  const sig = parseSignature(message.bodyText, message.fromName)
  await fillContact(supabase, message.from, { name: normalizeName(message.fromName), ...sig })
  if (!sig.phone && !sig.title) return
  const email = escapeLike(message.from)
  if (sig.phone) {
    await supabase
      .from('deals')
      .update({ contact_phone: sig.phone })
      .ilike('contact_email', email)
      .or('contact_phone.is.null,contact_phone.eq.')
  }
  const { data: people } = await supabase.from('deal_contacts').select('id, title, phone').ilike('email', email)
  for (const p of people ?? []) {
    const patch: Record<string, string> = {}
    if (sig.phone && blank(p.phone)) patch.phone = sig.phone
    if (sig.title && blank(p.title)) patch.title = sig.title
    if (Object.keys(patch).length) await supabase.from('deal_contacts').update(patch).eq('id', p.id)
  }
}

type FileOptions = {
  dealId: string | null
  lenderId: string | null
  // Which CRM lender this person or firm belongs to, if any.
  matchLender: (email: string | null, firm: string | null) => string | null
  dealIdForRef: (ref: string) => string | null
  // A new person was saved on a known lender, so later emails match.
  onContactAdded: (lenderId: string, email: string) => void
}

// What the full read found beyond deals and lender replies. A new person at
// a known lender is saved straight away; anything that needs judgment (a
// firm the CRM doesn't know, a request, a possible deal) goes on the review
// list instead. Returns short notes for the inbox log.
export async function fileFindings(
  supabase: SupabaseClient,
  message: InboxMessage,
  classification: EmailClassification,
  options: FileOptions
) {
  const notes: string[] = []
  const sender = message.fromName || message.from
  const source = { source_from: sender, source_subject: message.subject, graph_message_id: message.id }
  const rows: Record<string, unknown>[] = []
  const unknownFirms = new Map<string, Person[]>()

  for (const p of classification.people.slice(0, 15)) {
    const name = p.name?.trim()
    const email = p.email?.trim().toLowerCase() || null
    if (!name || looksLikeEmail(name) || isTeamName(name)) continue
    if (email && (TEAM_EMAIL.test(email) || email === message.from.toLowerCase())) continue
    if (p.role === 'borrower') continue

    // Already a contact: just fill the blanks.
    if (email && (await fillContact(supabase, email, { name, title: p.title, phone: p.phone }))) continue

    const lenderId = options.matchLender(email, p.firm)
    if (lenderId && email) {
      const { error } = await supabase
        .from('lender_contacts')
        .insert({ lender_id: lenderId, name, email, title: p.title || null, phone: p.phone || null })
      if (!error) {
        options.onContactAdded(lenderId, email)
        notes.push(`added ${name} as a lender contact`)
      }
    } else if (lenderId) {
      rows.push({
        ...source,
        kind: 'new_contact',
        title: `New contact: ${name}${p.firm ? ` at ${p.firm}` : ''}`,
        detail: p.why,
        firm: p.firm,
        people: [{ name, firm: p.firm, title: p.title, email: null, phone: p.phone }],
        lender_id: lenderId,
        deal_id: options.dealId,
        dedupe_key: `contact:${lenderId}:${name.toLowerCase()}`,
      })
    } else if (p.firm?.trim()) {
      const firm = p.firm.trim()
      unknownFirms.set(firm, [...(unknownFirms.get(firm) ?? []), { name, firm, title: p.title, email, phone: p.phone }])
    }
  }

  for (const [firm, people] of unknownFirms) {
    rows.push({
      ...source,
      kind: 'new_lender',
      title: `New lender: ${firm}`,
      detail: `${people.map((p) => p.name).join(', ')}. From ${sender}.`,
      firm,
      people,
      deal_id: options.dealId,
      dedupe_key: `lender:${firm.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    })
  }

  classification.action_items.slice(0, 5).forEach((item, i) => {
    rows.push({
      ...source,
      kind: item.type,
      title: item.text,
      detail: `From ${sender}.`,
      deal_id: options.dealId ?? (item.deal_ref ? options.dealIdForRef(item.deal_ref) : null),
      lender_id: options.lenderId,
      dedupe_key: `item:${message.id}:${i}`,
    })
  })

  if (rows.length) {
    const { error } = await supabase.from('email_findings').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    if (!error) notes.push(`${rows.length} for review on To do`)
  }
  return notes
}
