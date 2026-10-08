import type { SupabaseClient } from '@supabase/supabase-js'

// Spots deals that are probably the same borrower — the inbox can create a
// second deal when an email names a trust or company instead of the person.
// Free (no AI): compares contact email, phone, name and property addresses.

type DealLite = {
  id: string
  company_name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  description: string | null
  notes: string | null
  deal_type: string | null
  status: string
}

export type PossibleDuplicate = { id: string; company_name: string; status: string; reasons: string[] }

const DEAL_FIELDS = 'id, company_name, contact_name, contact_email, contact_phone, description, notes, deal_type, status'

const STREET =
  /\b(\d{2,6})\s+((?:[a-z]+\s+){0,3}?)(street|st|circle|cir|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd|way|court|ct|parkway|pkwy|highway|hwy|place|pl|terrace|ter|trail|trl)\b/gi

const SUFFIX: Record<string, string> = {
  street: 'st', circle: 'cir', road: 'rd', avenue: 'ave', drive: 'dr', lane: 'ln', boulevard: 'blvd',
  court: 'ct', parkway: 'pkwy', highway: 'hwy', place: 'pl', terrace: 'ter', trail: 'trl',
}

// "6224 Mount Salem Cir" → "6224 mount salem cir"
export function addresses(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(STREET)) {
    const suffix = m[3].toLowerCase()
    out.add(`${m[1]} ${m[2].trim().toLowerCase().replace(/\s+/g, ' ')} ${SUFFIX[suffix] ?? suffix}`.replace(/\s+/g, ' '))
  }
  return out
}

function phoneKey(p: string | null) {
  const digits = (p ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

function norm(s: string | null) {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function compare(a: DealLite, b: DealLite): string[] {
  const reasons: string[] = []
  if (a.contact_email && norm(a.contact_email) === norm(b.contact_email)) reasons.push(`same contact email (${b.contact_email})`)
  const pa = phoneKey(a.contact_phone)
  if (pa && pa === phoneKey(b.contact_phone)) reasons.push(`same contact phone (${b.contact_phone})`)
  const na = norm(a.contact_name)
  // A contact name matching the other deal's contact or company name.
  if (na.length > 3 && (na === norm(b.contact_name) || na === norm(b.company_name))) reasons.push(`same contact name (${a.contact_name})`)
  else if (norm(a.company_name).length > 3 && norm(a.company_name) === norm(b.contact_name)) reasons.push(`same name (${a.company_name})`)
  const textA = [a.company_name, a.description, a.notes, a.deal_type].join(' ')
  const textB = [b.company_name, b.description, b.notes, b.deal_type].join(' ')
  const shared = [...addresses(textA)].filter((x) => addresses(textB).has(x))
  if (shared.length) reasons.push(`same property address (${shared[0]})`)
  return reasons
}

export async function findPossibleDuplicates(supabase: SupabaseClient, dealId: string): Promise<PossibleDuplicate[]> {
  const { data } = await supabase.from('deals').select(DEAL_FIELDS)
  const deals = (data ?? []) as DealLite[]
  const me = deals.find((d) => d.id === dealId)
  if (!me) return []
  return deals
    .filter((d) => d.id !== dealId)
    .map((d) => ({ id: d.id, company_name: d.company_name, status: d.status, reasons: compare(me, d) }))
    .filter((d) => d.reasons.length > 0)
}
