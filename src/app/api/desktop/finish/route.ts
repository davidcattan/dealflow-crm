import { NextResponse, after } from 'next/server'
import { authenticateShortcut } from '@/lib/shortcut/keys'
import { autofillDeal } from '@/lib/deals/autofill'
import { buildKeyFacts } from '@/lib/deals/key-facts'

export const maxDuration = 300

type Uploaded = { path: string; fileName: string; size: number; contentType?: string | null }

// Mac folder sync, step 2: the files for one deal are uploaded — file them
// on the deal, then (after replying) fill blanks and refresh key facts once,
// the same as files that arrive by email.
export async function POST(request: Request) {
  const auth = await authenticateShortcut(request)
  if (!auth) return NextResponse.json({ error: 'Invalid key' }, { status: 401 })
  const { dealId, files } = (await request.json().catch(() => ({}))) as { dealId?: string; files?: Uploaded[] }
  if (!dealId || !Array.isArray(files) || files.length === 0) return NextResponse.json({ error: 'Missing dealId or files' }, { status: 400 })

  const { supabase, userId } = auth
  const { data: stored } = await supabase.storage.from('borrower-documents').list(dealId, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
  const there = new Set((stored ?? []).map((f) => `${dealId}/${f.name}`))

  const newIds: string[] = []
  const filed: string[] = []
  for (const f of files) {
    if (!f.path?.startsWith(`${dealId}/`) || !there.has(f.path)) continue
    const { data: doc } = await supabase
      .from('documents')
      .insert({
        deal_id: dealId,
        file_name: f.fileName,
        storage_path: f.path,
        file_size: f.size,
        content_type: f.contentType ?? null,
        uploaded_by: userId,
      })
      .select('id')
      .single()
    if (doc?.id) {
      newIds.push(doc.id as string)
      filed.push(f.fileName)
    }
  }

  if (newIds.length) {
    after(async () => {
      await autofillDeal(supabase, dealId, newIds).catch((err) => console.error('Autofill failed', err))
      await buildKeyFacts(supabase, dealId).catch(() => null)
    })
  }
  return NextResponse.json({ filed })
}
