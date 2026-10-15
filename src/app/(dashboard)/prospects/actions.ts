'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { ImportPerson } from '@/lib/prospects/columns'
import { PROSPECT_STATUSES, companyDomain, type ProspectStatus } from '@/lib/prospects/types'

const MIGRATION = 'Run migration 043_prospects.sql in Supabase first.'

// The spreadsheet's Status column → ours.
const SHEET_STATUS: Record<string, ProspectStatus> = {
  emailed: 'emailed',
  contacted: 'emailed',
  sent: 'emailed',
  interested: 'interested',
  'do not contact': 'do_not_contact',
  replied: 'replied',
  'meeting set': 'interested',
  deal: 'deal',
  'not interested': 'not_interested',
}

// Imports people already read from a file in the browser (any column
// names — see lib/prospects/columns). Matched by email: new people are
// added; people already here keep their status and history and just get
// their details filled in.
export async function importProspects(people: ImportPerson[], source: string) {
  const clean = (people ?? [])
    .filter((p) => p && typeof p.email === 'string' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(p.email) && p.company)
    .map((p) => ({ ...p, email: p.email.toLowerCase().trim(), domain: companyDomain(p.email) }))
  if (!clean.length) return { error: 'No rows with an email address. Is this the right file?' }

  const supabase = await createClient()
  const { data: existing, error: readError } = await supabase.from('prospects').select('email, status')
  if (readError) return { error: readError.message.includes('prospects') ? MIGRATION : readError.message }
  const have = new Map((existing ?? []).map((p) => [p.email as string, p.status as ProspectStatus]))

  const seen = new Set<string>()
  const fresh = []
  const refresh = []
  for (const { status: sheetText, ...p } of clean) {
    if (seen.has(p.email)) continue
    seen.add(p.email)
    const sheetStatus = SHEET_STATUS[(sheetText ?? '').trim().toLowerCase()] ?? null
    // Only non-empty values, so an import never blanks out what's there.
    const details = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== '')) as Partial<ImportPerson>
    if (have.has(p.email)) {
      // A file that says they were emailed moves a "Not contacted" person forward.
      refresh.push(have.get(p.email) === 'new' && sheetStatus ? { ...details, status: sheetStatus } : details)
    } else fresh.push({ ...p, source: source.trim() || null, status: sheetStatus ?? 'new' })
  }

  if (fresh.length) {
    const { error } = await supabase.from('prospects').insert(fresh)
    if (error) return { error: error.message }
  }
  for (const p of refresh) {
    await supabase.from('prospects').update({ ...p, updated_at: new Date().toISOString() }).eq('email', p.email!)
  }
  revalidatePath('/prospects')
  return { ok: true, added: fresh.length, updated: refresh.length }
}

export async function setProspectStatus(id: string, status: string) {
  if (!(PROSPECT_STATUSES as readonly string[]).includes(status)) return { error: 'Unknown status' }
  const supabase = await createClient()
  const { error } = await supabase.from('prospects').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/prospects')
  return { ok: true }
}

export type ProspectEmail = { id: string; at: string; sent: boolean; who: string; subject: string; body: string }

// Every email with this person, read live from each connected Outlook
// (David's and Eli's) — including ones sent before they were imported.
export async function getProspectEmails(email: string): Promise<{ emails: ProspectEmail[]; error?: string }> {
  const addr = email.trim().toLowerCase()
  if (!addr.includes('@')) return { emails: [] }
  const supabase = await createClient()
  const { data: conns } = await supabase.from('outlook_connections').select('id, account_email')
  const team = new Set((conns ?? []).map((c) => String(c.account_email).toLowerCase()))
  const { getValidAccessToken, searchMessagesWith } = await import('@/lib/outlook/graph')
  const { ownText } = await import('@/lib/outlook/own-text')
  const { mailboxOwner } = await import('@/lib/outlook/mailbox-label')

  const seen = new Set<string>()
  const emails: ProspectEmail[] = []
  let failed = 0
  for (const c of conns ?? []) {
    try {
      const { accessToken } = await getValidAccessToken(supabase, c.id as string)
      for (const m of await searchMessagesWith(accessToken, addr)) {
        const key = m.internetMessageId ?? `${m.subject}|${m.at}`
        if (seen.has(key)) continue
        seen.add(key)
        const sent = team.has(m.fromEmail)
        emails.push({
          id: m.id,
          at: m.at,
          sent,
          who: sent ? (mailboxOwner(m.fromEmail) ?? m.fromEmail) : m.fromName || m.fromEmail,
          subject: m.subject || '(no subject)',
          body: ownText(m.bodyText).slice(0, 6000),
        })
      }
    } catch {
      failed++
    }
  }
  emails.sort((a, b) => b.at.localeCompare(a.at))
  // Emailed before they were imported (or from a mailbox the sync missed):
  // bring "Not contacted" up to date.
  const lastSent = emails.find((e) => e.sent)
  if (lastSent) {
    await supabase.from('prospects').update({ status: 'emailed', last_emailed_at: lastSent.at }).eq('email', addr).eq('status', 'new')
  }
  return { emails, ...(failed && !emails.length ? { error: "Couldn't reach Outlook — check Settings → Outlook." } : {}) }
}
