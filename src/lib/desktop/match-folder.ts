import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

const INACTIVE = ['dead', 'closed', 'old']
const FILLER = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'company', 'the', 'lp', 'llp', 'pllc'])

// "TEAM Inc" / "Team, Inc." → "team"; "Lion ENergy" → "lionenergy".
function key(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !FILLER.has(w))
    .join('')
}

// The deal a Desktop folder (JED/Deals/<folder>) belongs to: same name once
// case, punctuation and Inc/LLC are ignored; failing that, the one deal whose
// name starts with the folder's (or the other way round). Live deals win
// over dead/old ones with the same name.
export async function dealForFolder(supabase: SupabaseClient, folder: string) {
  const want = key(folder)
  if (want.length < 2) return null
  const { data } = await supabase.from('deals').select('id, company_name, status, created_at').order('created_at', { ascending: false })
  const deals = (data ?? []).map((d) => ({ id: d.id as string, name: d.company_name as string, live: !INACTIVE.includes(d.status as string), key: key(String(d.company_name ?? '')) }))
  const pick = (list: typeof deals) => list.find((d) => d.live) ?? list[0] ?? null

  const exact = deals.filter((d) => d.key === want)
  if (exact.length) return pick(exact)
  if (want.length < 5) return null
  const close = deals.filter((d) => d.key.length >= 5 && (d.key.startsWith(want) || want.startsWith(d.key)))
  const live = close.filter((d) => d.live)
  if (live.length === 1) return live[0]
  if (close.length === 1) return close[0]
  return null
}
