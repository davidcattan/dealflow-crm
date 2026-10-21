import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

const INACTIVE = ['dead', 'closed', 'old']
const FILLER = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'company', 'the', 'lp', 'llp', 'pllc', 'and'])

// "TEAM Inc" → ["team"]; "Avo Kegeyan (business name not stated)" →
// ["avo", "kegeyan"] — notes in parentheses aren't part of the name.
function words(name: string) {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !FILLER.has(w))
}
const key = (name: string) => words(name).join('')
// "AVO Kegeyan - Insurance" → "AVO Kegeyan": a label after a dash isn't the name.
const base = (folder: string) => folder.split(/\s+[-–—]\s+/)[0]

type Candidate = { id: string; name: string; live: boolean; key: string; words: string[]; contactKey: string }

// One deal from a list of candidates: a single live deal, else a single deal
// at all; live deals win over dead/old ones with the same name.
function one(list: Candidate[]) {
  const live = list.filter((d) => d.live)
  if (live.length === 1) return live[0]
  if (list.length === 1) return list[0]
  return null
}

// The deal a Desktop folder (JED/Deals/<folder>) belongs to, trying in order:
// the same name (case, punctuation, Inc/LLC and notes in parentheses
// ignored), with or without a label after a dash; every word of one name
// inside the other; the deal's contact person; one name starting with the
// other. Only a single clear match counts.
export async function dealForFolder(supabase: SupabaseClient, folder: string) {
  const full = key(folder)
  const short = key(base(folder))
  if (short.length < 2) return null
  const { data } = await supabase
    .from('deals')
    .select('id, company_name, contact_name, status, created_at')
    .order('created_at', { ascending: false })
  const deals: Candidate[] = (data ?? []).map((d) => ({
    id: d.id as string,
    name: d.company_name as string,
    live: !INACTIVE.includes(d.status as string),
    key: key(String(d.company_name ?? '')),
    words: words(String(d.company_name ?? '')),
    contactKey: key(String(d.contact_name ?? '')),
  }))

  const exact = deals.filter((d) => d.key && (d.key === full || d.key === short))
  if (exact.length) return exact.find((d) => d.live) ?? exact[0]

  const folderWords = new Set(words(base(folder)))
  const contained = deals.filter((d) => {
    const dealWords = d.words.filter((w) => w.length > 1)
    if (!dealWords.length || d.key.length < 5) return false
    return dealWords.every((w) => folderWords.has(w)) || [...folderWords].every((w) => dealWords.includes(w))
  })
  if (one(contained)) return one(contained)

  const byContact = deals.filter((d) => d.contactKey.length >= 5 && d.contactKey === short)
  if (one(byContact)) return one(byContact)

  if (short.length < 5) return null
  return one(deals.filter((d) => d.key.length >= 5 && (d.key.startsWith(short) || short.startsWith(d.key))))
}
