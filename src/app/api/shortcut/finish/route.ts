import { after } from 'next/server'
import { authenticateShortcut } from '@/lib/shortcut/keys'
import { advanceCall, startTranscription } from '@/lib/calls/process'

// Keeps working on the call after replying, so the notes are written even
// if nobody opens the deal.
export const maxDuration = 300

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

// iPhone shortcut, step 3: the recording is uploaded — file it on the deal
// and start the transcript + notes. Replies with a line the phone shows.
export async function POST(request: Request) {
  const auth = await authenticateShortcut(request)
  if (!auth) return text('Your JED CRM key isn’t valid — make a new one in CRM Settings.', 401)
  const url = new URL(request.url)
  const dealId = url.searchParams.get('deal') ?? ''
  const path = url.searchParams.get('path') ?? ''
  if (!dealId || !path.startsWith(`calls/${dealId}/sc-`)) return text('Something went wrong — try sending it again.', 400)

  const { supabase, userId } = auth
  const { data: deal } = await supabase.from('deals').select('company_name').eq('id', dealId).single()
  const fileName = path.split('/').pop() ?? ''
  const { data: files } = await supabase.storage.from('borrower-documents').list(`calls/${dealId}`, { search: fileName })
  if (!deal || !files?.some((f) => f.name === fileName)) return text('The recording didn’t upload — try sending it again.', 400)

  const { data: call, error } = await supabase
    .from('deal_calls')
    .insert({ deal_id: dealId, storage_path: path, created_by: userId })
    .select('id')
    .single()
  if (error || !call) return text('Couldn’t save the call — try again.', 500)
  await startTranscription(supabase, call.id)

  after(async () => {
    const until = Date.now() + 270_000
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 10_000))
      await advanceCall(supabase, call.id).catch(() => {})
      const { data } = await supabase.from('deal_calls').select('status').eq('id', call.id).single()
      if (!data || data.status === 'done' || data.status === 'error') return
    }
  })

  return text(`Sent to ${deal.company_name} ✓ The call notes will be on the deal in a minute or two.`)
}
