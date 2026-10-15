'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { parseCsv } from '@/lib/prospects/csv'
import { PROSPECT_STATUSES, companyDomain, type ProspectStatus } from '@/lib/prospects/types'

const MIGRATION = 'Run migration 043_prospects.sql in Supabase first.'

// The spreadsheet's Status column → ours.
const SHEET_STATUS: Record<string, ProspectStatus> = {
  emailed: 'emailed',
  replied: 'replied',
  'meeting set': 'interested',
  deal: 'deal',
  'not interested': 'not_interested',
}

const pick = (row: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (row[k]?.trim()) return row[k].trim()
  return ''
}

// Imports a contact list (the "Outreach list" / Contacts file, or a raw
// Apollo export). Matched by email: new people are added, people already
// here keep their status and history and just get their details refreshed.
export async function importProspects(csvText: string, source: string) {
  const rows = parseCsv(csvText)
  if (!rows.length) return { error: 'That file looks empty.' }
  const people = rows
    .map((r) => {
      const email = pick(r, 'Email', 'email').toLowerCase()
      const company = pick(r, 'Company', 'Company Name')
      if (!email || !email.includes('@') || !company) return null
      return {
        email,
        company,
        company_display: pick(r, 'Company (for email)') || null,
        first_name: pick(r, 'First Name') || null,
        last_name: pick(r, 'Last Name') || null,
        title: pick(r, 'Title') || null,
        phone: pick(r, 'Phone', 'Mobile Phone', 'Work Direct Phone', 'Corporate Phone', 'Company Phone') || null,
        linkedin: pick(r, 'LinkedIn', 'Person Linkedin Url') || null,
        city: pick(r, 'City') || null,
        state: pick(r, 'State') || null,
        website: pick(r, 'Website') || null,
        domain: companyDomain(email),
        lender: pick(r, 'Lender') || null,
        amount: pick(r, 'Amount') || null,
        deal_year: pick(r, 'Year') || null,
        source: source.trim() || null,
        sheetStatus: SHEET_STATUS[pick(r, 'Status').toLowerCase()] ?? null,
      }
    })
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
  if (!people.length) return { error: 'No rows with both a company and an email. Is this the right file?' }

  const supabase = await createClient()
  const { data: existing, error: readError } = await supabase.from('prospects').select('email, status')
  if (readError) return { error: readError.message.includes('prospects') ? MIGRATION : readError.message }
  const have = new Map((existing ?? []).map((p) => [p.email as string, p.status as ProspectStatus]))

  const seen = new Set<string>()
  const fresh = []
  const refresh = []
  for (const { sheetStatus, ...p } of people) {
    if (seen.has(p.email)) continue
    seen.add(p.email)
    if (have.has(p.email)) {
      // Keep what's already known (status, source); fill in details. A file
      // that says they were emailed moves a "Not contacted" person forward.
      const { source: _source, ...details } = p
      void _source
      refresh.push(have.get(p.email) === 'new' && sheetStatus ? { ...details, status: sheetStatus } : details)
    } else fresh.push({ ...p, status: sheetStatus ?? 'new' })
  }

  if (fresh.length) {
    const { error } = await supabase.from('prospects').insert(fresh)
    if (error) return { error: error.message }
  }
  for (const p of refresh) {
    await supabase.from('prospects').update({ ...p, updated_at: new Date().toISOString() }).eq('email', p.email)
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
