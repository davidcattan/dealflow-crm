import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { startTranscription } from '@/lib/calls/process'

export const maxDuration = 60

// A call with a lender (not about one deal) was just uploaded: save it and
// send it off to be transcribed.
export async function POST(request: Request, ctx: RouteContext<'/api/lenders/[id]/calls'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { storagePath, storagePaths, durationSeconds } = (await request.json()) as {
    storagePath?: string
    storagePaths?: string[]
    durationSeconds?: number
  }
  // A continued recording comes in several pieces, in order.
  const paths = storagePaths?.length ? storagePaths : storagePath ? [storagePath] : []
  if (!paths.length || paths.some((x) => !x.startsWith(`calls/lender-${id}/`)))
    return NextResponse.json({ error: 'Bad recording path' }, { status: 400 })

  const { data: call, error } = await supabase
    .from('deal_calls')
    .insert({
      lender_id: id,
      call_with: 'lender',
      storage_path: paths[0],
      // Only sent when there are pieces, so single recordings work before migration 031.
      ...(paths.length > 1 ? { extra_paths: paths.slice(1) } : {}),
      duration_seconds: durationSeconds ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error || !call) {
    const needsMigration = error?.message.includes('deal_id') || error?.message.includes('deal_calls')
    return NextResponse.json(
      { error: needsMigration ? 'Run migration 030_lender_calls.sql in Supabase first.' : (error?.message ?? 'Couldn’t save the call') },
      { status: 500 }
    )
  }
  await startTranscription(supabase, call.id)
  return NextResponse.json({ id: call.id })
}
