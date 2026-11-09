import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// The same file (same name and size) on a deal more than once — email, the
// Mac folder sync and a drag-and-drop can all deliver it at about the same
// time, each before the others have saved theirs. The first copy stays; the
// later copies and their stored files are removed.
//
// Agreements also pile up as versions while they're negotiated (an NDA
// edited and sent back and forth: "(JED redline)", "_Blueline", "(for
// signature)", "v2"…). For those only the newest version stays. Executed or
// signed copies are never removed, and files that arrived together (a
// redline and its clean copy in one email) are both kept.

type Doc = { id: string; deal_id: string; file_name: string; file_size: number | null; storage_path: string; uploaded_at: string }

const AGREEMENT = /\b(nda|non[- ]?disclosure|confidentiality|engagement letter|term sheet|loi|letter of intent|agreement)\b/
const SIGNED = /(executed|signed|countersigned)/
const VERSION_WORDS = 'v\\d+|version|rev|revised|redline|blueline|blackline|markup|marked|clean|draft|final|updated|comments?|response|for signature|copy'
// Files saved within this long of the newest version came with it.
const SAME_DELIVERY_MS = 2 * 60_000

// What a file is a version of, or null when it isn't a negotiated agreement.
// Word and PDF copies are kept apart (the signed PDF of a Word draft isn't
// a newer draft).
export function versionFamily(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  let base = (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase().replace(/_/g, ' ')
  if (!AGREEMENT.test(base) || SIGNED.test(base)) return null
  base = base
    // "(JED redline)", "(Revised 10-20-26)", "(v2 work fee)", "(10-13-26)", "(546854547.1)"
    .replace(new RegExp(`\\([^)]*\\b(${VERSION_WORDS})\\b[^)]*\\)`, 'g'), ' ')
    .replace(/\(\s*[\d.\-/ ]+\s*\)/g, ' ')
    // "…v2", "… Blueline", "… clean"
    .replace(new RegExp(`(^|[\\s\\-])(${VERSION_WORDS})(?=$|[\\s\\-])`, 'g'), ' ')
    // "2-Silver Lining…"
    .replace(/^\d+\s*-\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!base) return null
  const kind = ext === 'pdf' ? 'pdf' : ext === 'doc' || ext === 'docx' ? 'word' : ext
  return `${base}|${kind}`
}

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
  const families = new Map<string, Doc[]>()
  for (const d of (data ?? []) as Doc[]) {
    if (d.file_size === null) continue
    // Same size and type is the same file even under another name (renamed
    // copies, "file[2].pdf" re-downloads). Tiny files are matched by name
    // too, since unrelated small files can share a size.
    const ext = d.file_name.includes('.') ? d.file_name.split('.').pop()!.toLowerCase() : ''
    const key = d.file_size >= 2048 ? `${d.deal_id}|${ext}|${d.file_size}` : `${d.deal_id}|${d.file_name}|${d.file_size}`
    if (kept.has(key)) {
      extra.push(d)
      continue
    }
    kept.add(key)
    const family = versionFamily(d.file_name)
    if (family) families.set(`${d.deal_id}|${family}`, [...(families.get(`${d.deal_id}|${family}`) ?? []), d])
  }
  for (const versions of families.values()) {
    const newest = Date.parse(versions[versions.length - 1].uploaded_at)
    for (const d of versions) if (newest - Date.parse(d.uploaded_at) > SAME_DELIVERY_MS) extra.push(d)
  }
  if (!extra.length) return 0

  await supabase.storage.from('borrower-documents').remove(extra.map((d) => d.storage_path))
  await supabase.from('documents').delete().in('id', extra.map((d) => d.id))
  return extra.length
}
