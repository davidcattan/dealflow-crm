import { NextResponse } from 'next/server'
import { sessionOrKey } from '@/lib/shortcut/keys'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocumentRecord } from '@/lib/types'
import { loadDealEmails } from '@/lib/deals/deal-emails'
import { findPossibleDuplicates } from '@/lib/deals/duplicates'
import { loadLenderSearchPrompt } from '@/lib/lender-search/run'

// Deals waiting for underwriting by Claude Code, with everything needed to
// do it: deal info and a download link for each document. Requires a
// signed-in session (Claude Code on the Mac uses the logged-in browser pane)
// or a personal key ("Authorization: Bearer jed_…", the cloud queue job).
export async function GET(request: Request) {
  const auth = await sessionOrKey(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { supabase } = auth

  const { data: deals } = await supabase
    .from('deals')
    .select(
      'id, company_name, industry, loan_type, website, description, notes, deal_type, underwriting_requested_at, underwriting_requested_kind, lender_search_requested_at'
    )
    .or('underwriting_requested_at.not.is.null,lender_search_requested_at.not.is.null')
    .order('created_at', { ascending: true })

  const out = []
  for (const deal of deals ?? []) {
    const [{ data: docs }, { data: updates }, emails, possible_duplicates] = await Promise.all([
      supabase.from('documents').select('*').eq('deal_id', deal.id).order('uploaded_at'),
      supabase
        .from('deal_updates')
        .select('entry_date, note')
        .eq('deal_id', deal.id)
        .order('entry_date', { ascending: false, nullsFirst: false })
        .limit(10),
      loadDealEmails(supabase, deal.id),
      findPossibleDuplicates(supabase, deal.id),
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
    // A queued "find new lenders" search: the full instructions + context.
    const lender_search_prompt = deal.lender_search_requested_at ? await loadLenderSearchPrompt(supabase, deal.id) : null
    // The possible duplicates' own files and emails, so the job can read
    // them without opening the deal pages.
    const duplicate_details = []
    for (const dup of possible_duplicates) {
      duplicate_details.push({
        id: dup.id,
        company_name: dup.company_name,
        documents: await signedDocs(supabase, dup.id),
        emails: await loadDealEmails(supabase, dup.id, 10),
      })
    }
    out.push({ ...deal, possible_duplicates, duplicate_details, updates: updates ?? [], emails, documents, lender_search_prompt })
  }
  return NextResponse.json({ queued: out })
}

async function signedDocs(supabase: SupabaseClient, dealId: string) {
  const { data: docs } = await supabase.from('documents').select('*').eq('deal_id', dealId).order('uploaded_at')
  const out = []
  for (const d of (docs ?? []) as DocumentRecord[]) {
    const { data } = await supabase.storage.from('borrower-documents').createSignedUrl(d.storage_path, 60 * 60, { download: d.file_name })
    out.push({ file_name: d.file_name, content_type: d.content_type, size: d.file_size, triage: d.triage, url: data?.signedUrl ?? null })
  }
  return out
}
