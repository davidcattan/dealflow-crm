import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { getDocText } from '@/lib/chat/doc-text'
import { versionFamily } from '@/lib/deals/duplicate-documents'
import type { DocumentRecord } from '@/lib/types'

// Two files on a deal with the same name but different sizes: an updated
// version ("P&L by month.xlsx" re-sent with November added) or two different
// documents that happen to share a name ("Statement.pdf" for October and for
// November)? The name can't tell, so the cheap model compares what's inside.
// A newer version marks the older one replaced — kept, never deleted.
// Exact duplicates (same size) and negotiated agreements are handled in
// duplicate-documents.ts.

const MODEL = 'claude-haiku-5-5'
const SAMPLE_CHARS = 6000

const Schema = z.object({
  verdict: z
    .enum(['b_replaces_a', 'a_replaces_b', 'different_documents', 'unsure'])
    .describe(
      'b_replaces_a / a_replaces_b = the same document for the same company, and one is an updated version of the other (covers a later period, adds months, or corrects figures). different_documents = they cover different periods that do not overlap (e.g. October vs November statements), different accounts, or different companies. unsure = can\'t tell.'
    ),
  reason: z.string().describe('One short line, e.g. "B adds Oct 2026; same monthly P&L".'),
})

type Doc = DocumentRecord & { replaced_by?: string | null; versions_checked_at?: string | null }

const sample = async (supabase: SupabaseClient, d: Doc) => {
  const t = await getDocText(supabase, d).catch(() => null)
  return (t?.pages ?? []).join('\n').slice(0, SAMPLE_CHARS)
}

// Checks files added in the last `sinceHours` that share a name with an
// earlier file on the same deal. Small: most uploads have no namesake.
export async function markReplacedVersions(supabase: SupabaseClient, opts: { sinceHours?: number; dealId?: string } = {}) {
  const since = new Date(Date.now() - (opts.sinceHours ?? 48) * 3_600_000).toISOString()
  let q = supabase.from('documents').select('*').gte('uploaded_at', since).order('uploaded_at', { ascending: true }).limit(200)
  if (opts.dealId) q = q.eq('deal_id', opts.dealId)
  const { data: fresh, error } = await q
  // Columns not there yet (migration 054): nothing to do.
  if (error || !fresh?.length || !('versions_checked_at' in fresh[0])) return 0
  const todo = (fresh as Doc[]).filter((d) => !d.versions_checked_at)
  if (!todo.length) return 0

  const client = new Anthropic()
  let marked = 0
  for (const b of todo) {
    const name = b.file_name.trim().toLowerCase()
    const { data: same } = await supabase
      .from('documents')
      .select('*')
      .eq('deal_id', b.deal_id)
      .ilike('file_name', b.file_name.trim().replace(/[\\%_]/g, '\\$&'))
      .neq('id', b.id)
    const earlier = ((same ?? []) as Doc[]).filter(
      (a) => a.file_name.trim().toLowerCase() === name && a.file_size !== b.file_size && !a.replaced_by && a.uploaded_at <= b.uploaded_at
    )
    // Agreements (NDA redlines…) are versioned by duplicate-documents.ts.
    if (earlier.length && !versionFamily(b.file_name)) {
      const textB = await sample(supabase, b)
      for (const a of earlier) {
        const textA = await sample(supabase, a)
        if (!textA || !textB) continue
        const res = await client.messages.parse({
          model: MODEL,
          max_tokens: 1500,
          messages: [
            {
              role: 'user',
              content: `Two files on the same loan deal share the name "${b.file_name}". Is one an updated version of the other, or are they different documents?\n\n--- A (saved ${a.uploaded_at.slice(0, 10)}) ---\n${textA}\n\n--- B (saved ${b.uploaded_at.slice(0, 10)}) ---\n${textB}`,
            },
          ],
          output_config: { effort: 'low', format: zodOutputFormat(Schema) },
        })
        await logUsage({ feature: 'document-versions', model: MODEL, dealId: b.deal_id, usage: res.usage, supabase })
        const v = res.parsed_output?.verdict
        if (v === 'b_replaces_a') {
          await supabase.from('documents').update({ replaced_by: b.id }).eq('id', a.id)
          marked++
        } else if (v === 'a_replaces_b') {
          await supabase.from('documents').update({ replaced_by: a.id }).eq('id', b.id)
          marked++
        }
      }
    }
    await supabase.from('documents').update({ versions_checked_at: new Date().toISOString() }).eq('id', b.id)
  }
  return marked
}
