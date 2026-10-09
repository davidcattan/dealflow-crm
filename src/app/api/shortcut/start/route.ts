import { NextResponse } from 'next/server'
import { authenticateShortcut } from '@/lib/shortcut/keys'
import { shortcutDeals } from '@/lib/shortcut/deals'

// iPhone shortcut, step 2: for the picked deal, a place to upload the
// recording straight to storage (big files can't go through our server),
// and the address to call once it's uploaded.
export async function POST(request: Request) {
  const auth = await authenticateShortcut(request)
  if (!auth) return NextResponse.json({ error: 'Invalid key' }, { status: 401 })
  const { deal, ext } = (await request.json().catch(() => ({}))) as { deal?: string; ext?: string }
  const match = (await shortcutDeals(auth.supabase)).find((d) => d.label === String(deal ?? '').trim())
  if (!match) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  const safeExt = (ext ?? 'm4a').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'm4a'
  const path = `calls/${match.id}/sc-${Date.now()}.${safeExt}`
  const { data, error } = await auth.supabase.storage.from('borrower-documents').createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: 'Couldn’t prepare the upload' }, { status: 500 })

  const origin = new URL(request.url).origin
  return NextResponse.json({
    upload_url: data.signedUrl,
    finish_url: `${origin}/api/shortcut/finish?deal=${match.id}&path=${encodeURIComponent(path)}`,
  })
}
