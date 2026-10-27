import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// The same file (same name and size) on a deal more than once — email, the
// Mac folder sync and a drag-and-drop can all deliver it at about the same
// time, each before the others have saved theirs. The first copy stays; the
// later copies and their stored files are removed.

type Doc = { id: string; deal_id: string; file_name: string; file_size: number | null; storage_path: string; uploaded_at: string }

// Only deals given a file in the last `sinceHours` (or the one deal named)
// are checked, so the scheduled run stays small.
export async function removeDuplicateDocuments(supabase: SupabaseClient, opts: { dealId?: string; sinceHours?: number } = {}) {
  let dealIds: string[]
  if (opts.dealId) dealIds = [opts.dealId]
  else {
    const since = new Date(Date.now() - (opts.sinceHours ?? 24) * 3_600_000).toISOString()
    const { data } = await supabase.from('documents').select('deal_id').gte('uploaded_at', since)
    dealIds = [...new Set((data ?? []).map((d) => d.deal_id as string))]
  }
  if (!dealIds.length) return 0

  const { data } = await supabase
    .from('documents')
    .select('id, deal_id, file_name, file_size, storage_path, uploaded_at')
    .in('deal_id', dealIds)
    .order('uploaded_at', { ascending: true })
  const kept = new Set<string>()
  const extra: Doc[] = []
  for (const d of (data ?? []) as Doc[]) {
    if (d.file_size === null) continue
    const key = `${d.deal_id}|${d.file_name}|${d.file_size}`
    if (kept.has(key)) extra.push(d)
    else kept.add(key)
  }
  if (!extra.length) return 0

  await supabase.storage.from('borrower-documents').remove(extra.map((d) => d.storage_path))
  await supabase.from('documents').delete().in('id', extra.map((d) => d.id))
  return extra.length
}
