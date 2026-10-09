import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadLastActivity } from '@/lib/deals/load-next-steps'

const INACTIVE = ['dead', 'closed', 'old']

// Active deals, most recently active first, with names made unique so the
// shortcut's pick maps back to exactly one deal.
export async function shortcutDeals(supabase: SupabaseClient) {
  const { data } = await supabase.from('deals').select('id, company_name, status, updated_at')
  const deals = (data ?? []).filter((d) => !INACTIVE.includes(d.status as string))
  const last = await loadLastActivity(
    supabase,
    deals.map((d) => d.id as string)
  )
  const sorted = deals.sort((a, b) =>
    String(last.get(b.id as string) ?? b.updated_at).localeCompare(String(last.get(a.id as string) ?? a.updated_at))
  )
  const seen = new Map<string, number>()
  return sorted.map((d) => {
    const name = String(d.company_name).replace(/\s+/g, ' ').trim()
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return { id: d.id as string, label: n > 1 ? `${name} (${n})` : name }
  })
}
