import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DocumentRecord } from '@/lib/types'

// Deals waiting for underwriting by Claude Code, with everything needed to
// do it: deal info and a download link for each document. Requires a
// signed-in session (Claude Code uses the logged-in browser pane).
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: deals } = await supabase
    .from('deals')
    .select('id, company_name, industry, loan_type, website, description, notes, deal_type, underwriting_requested_at')
    .not('underwriting_requested_at', 'is', null)
    .order('underwriting_requested_at', { ascending: true })

  const out = []
  for (const deal of deals ?? []) {
    const [{ data: docs }, { data: updates }] = await Promise.all([
      supabase.from('documents').select('*').eq('deal_id', deal.id).order('uploaded_at'),
      supabase
        .from('deal_updates')
        .select('entry_date, note')
        .eq('deal_id', deal.id)
        .order('entry_date', { ascending: false, nullsFirst: false })
        .limit(10),
    ])
    const documents = []
    for (const d of (docs ?? []) as DocumentRecord[]) {
      const { data } = await supabase.storage
        .from('borrower-documents')
        .createSignedUrl(d.storage_path, 60 * 60, { download: d.file_name })
      documents.push({
        file_name: d.file_name,
        content_type: d.content_type,
        size: d.file_size,
        triage: d.triage,
        url: data?.signedUrl ?? null,
      })
    }
    out.push({ ...deal, updates: updates ?? [], documents })
  }
  return NextResponse.json({ queued: out })
}
