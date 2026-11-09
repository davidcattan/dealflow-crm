import { NextResponse } from 'next/server'
import { authenticateShortcut } from '@/lib/shortcut/keys'
import { dealForFolder } from '@/lib/desktop/match-folder'

// Mac folder sync, step 1: for a file saved in Desktop/JED/Deals/<folder>,
// find the deal and hand back a place to upload it straight to storage (big
// files can't go through our server). Skips files the deal already has.
export async function POST(request: Request) {
  const auth = await authenticateShortcut(request)
  if (!auth) return NextResponse.json({ error: 'Invalid key' }, { status: 401 })
  const { folder, fileName, size } = (await request.json().catch(() => ({}))) as {
    folder?: string
    fileName?: string
    size?: number
  }
  if (!folder || !fileName || typeof size !== 'number') return NextResponse.json({ error: 'Missing folder, fileName or size' }, { status: 400 })

  const deal = await dealForFolder(auth.supabase, folder)
  if (!deal) return NextResponse.json({ skip: 'no_deal' })

  // Same size and same file type counts as the same file, whatever it's
  // named: a renamed copy (e.g. a lender package built from the deal's own
  // files) would otherwise upload every document a second time.
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : ''
  const { data: same } = await auth.supabase
    .from('documents')
    .select('id')
    .eq('deal_id', deal.id)
    .eq('file_size', size)
    .ilike('file_name', ext ? `%.${ext}` : fileName)
    .limit(1)
  if (same?.length) return NextResponse.json({ skip: 'already_there', dealId: deal.id, dealName: deal.name })

  const path = `${deal.id}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { data, error } = await auth.supabase.storage.from('borrower-documents').createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: 'Couldn’t prepare the upload' }, { status: 500 })
  return NextResponse.json({ dealId: deal.id, dealName: deal.name, path, upload_url: data.signedUrl })
}
